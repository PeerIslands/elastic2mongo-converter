/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */
/**
 * # Import
 *
 * @see startImport() for the primary entrypoint.
 *
 * ```
 *         openImport()
 *               | [user specifies import options or defaults]
 * closeImport() | startImport()
 *               | > cancelImport()
 * ```
 *
 * - [User actions for speficying import options] can be called once the modal has been opened
 * - Once `startImport()` has been called, [Import status action creators] are created internally
 *
 * NOTE: lucas: Any values intended for internal-use only, such as the action
 * creators for import status/progress, are called out with @api private
 * doc strings. This way, they can still be exported as needed for testing
 * without having to think deeply on whether they are being called from a top-level
 * action or not. Not great, but it has saved me a considerable amount of time vs.
 * larger scale refactoring/frameworks.
 */

import { promisify } from 'util';
import fs from 'fs';

import stream from 'stream';
import stripBomStream from 'strip-bom-stream';
import mime from 'mime-types';

import type { AnyAction, Dispatch } from 'redux';
import type { ThunkAction, ThunkDispatch } from 'redux-thunk';

import PROCESS_STATUS from '../constants/process-status';
import FILE_TYPES from '../constants/file-types';
import { globalAppRegistryEmit, nsChanged } from './compass';

import detectImportFile from '../utils/detect-import-file';
import { createCollectionWriteStream } from '../utils/collection-stream';
import createParser, { createProgressStream } from '../utils/import-parser';
import {
  createPeekStream,
  createPreviewWritable,
} from '../utils/import-preview';

import createImportSizeGuesstimator from '../utils/import-size-guesstimator';
import { transformProjectedTypesStream } from '../utils/import-apply-types-and-projection';

import type { ProcessStatus } from '../constants/process-status';
import type { RootImportState } from '../stores/import-store';
import type { AcceptedFileType } from '../constants/file-types';
import type {
  CollectionStreamProgress,
  WritableCollectionStream,
} from '../utils/collection-stream';

import createLoggerAndTelemetry from '@mongodb-js/compass-logging';

const checkFileExists = promisify(fs.exists);
const getFileStats = promisify(fs.stat);

const { log, mongoLogId, debug, track } = createLoggerAndTelemetry(
  'COMPASS-IMPORT-EXPORT-UI'
);

/**
 * ## Action names
 */
const PREFIX = 'import-export/import';
export const STARTED = `${PREFIX}/STARTED`;
export const CANCELED = `${PREFIX}/CANCELED`;
export const GUESSTIMATED_PROGRESS = `${PREFIX}/GUESSTIMATED_PROGRESS`;
export const PROGRESS = `${PREFIX}/PROGRESS`;
export const FINISHED = `${PREFIX}/FINISHED`;
export const FAILED = `${PREFIX}/FAILED`;
export const FILE_TYPE_SELECTED = `${PREFIX}/FILE_TYPE_SELECTED`;
export const FILE_SELECTED = `${PREFIX}/FILE_SELECTED`;
export const OPEN = `${PREFIX}/OPEN`;
export const CLOSE = `${PREFIX}/CLOSE`;
export const SET_PREVIEW = `${PREFIX}/SET_PREVIEW`;
export const SET_DELIMITER = `${PREFIX}/SET_DELIMITER`;
export const SET_GUESSTIMATED_TOTAL = `${PREFIX}/SET_GUESSTIMATED_TOTAL`;
export const SET_STOP_ON_ERRORS = `${PREFIX}/SET_STOP_ON_ERRORS`;
export const SET_IGNORE_BLANKS = `${PREFIX}/SET_IGNORE_BLANKS`;
export const TOGGLE_INCLUDE_FIELD = `${PREFIX}/TOGGLE_INCLUDE_FIELD`;
export const SET_FIELD_TYPE = `${PREFIX}/SET_FIELD_TYPE`;

type FieldType = {
  path: string;
  checked: boolean;
  type?: string; // Only on csv imports.
};

type State = {
  isOpen?: boolean;
  errors: Error[];
  fileType: AcceptedFileType | '';
  fileName: string;
  fileIsMultilineJSON: boolean;
  useHeaderLines: boolean;
  status: ProcessStatus;

  fileStats: null | fs.Stats;
  docsTotal: number;
  docsProcessed: number;
  docsWritten: number;
  guesstimatedDocsTotal: number;
  guesstimatedDocsProcessed: number;
  delimiter: string;
  stopOnErrors: boolean;

  ignoreBlanks: boolean;
  fields: FieldType[];
  values: null[];
  previewLoaded: boolean;
  exclude: string[];
  transform: [string, string | undefined][];

  source?: fs.ReadStream;
  dest?: WritableCollectionStream;
};

/**
 * ## Initial state.
 *
 * @api private
 */
export const INITIAL_STATE: State = {
  isOpen: false,
  errors: [],
  fileName: '',
  fileIsMultilineJSON: false,
  useHeaderLines: true,
  status: PROCESS_STATUS.UNSPECIFIED,
  fileStats: null,
  docsTotal: -1,
  docsProcessed: 0,
  docsWritten: 0,
  guesstimatedDocsTotal: 0,
  guesstimatedDocsProcessed: 0,
  delimiter: ',',
  stopOnErrors: false,
  ignoreBlanks: true,
  fields: [],
  values: [],
  previewLoaded: false,
  exclude: [],
  transform: [],
  fileType: '',
};

/**
 * ### Import status action creators
 *
 * @see startImport below.
 *
 * ```
 * STARTED >
 * | *ERROR* || SET_GUESSTIMATED_TOTAL >
 *           | <-- PROGRESS -->
 *           | *FINISHED*
 * ```
 */

/**
 * @param {Number} progress
 * @param {Number} docsWritten
 * @api private
 */
export const onGuesstimatedProgress = (
  docsProcessed: number,
  docsTotal: number
) => ({
  type: GUESSTIMATED_PROGRESS,
  guesstimatedDocsProcessed: docsProcessed,
  guesstimatedDocsTotal: docsTotal,
});

export const onProgress = ({
  docsWritten,
  docsProcessed,
  errors,
}: CollectionStreamProgress) => ({
  type: PROGRESS,
  docsWritten,
  docsProcessed,
  errors,
});

export const onStarted = (
  source: fs.ReadStream,
  dest: WritableCollectionStream
) => ({
  type: STARTED,
  source: source,
  dest: dest,
});

export const onFinished = (docsWritten: number, docsTotal: number) => ({
  type: FINISHED,
  docsWritten,
  docsTotal,
});

export const onFailed = (error: Error) => ({ type: FAILED, error });

export const onGuesstimatedDocsTotal = (guesstimatedDocsTotal: number) => ({
  type: SET_GUESSTIMATED_TOTAL,
  guesstimatedDocsTotal: guesstimatedDocsTotal,
});

/**
 * Sets up a streaming based pipeline to execute the import
 * and update status/progress.
 *
 * All of the exciting bits happen in `../utils/` :)
 * @api public
 */
export const startImport = () => {
  return (
    dispatch: ThunkDispatch<RootImportState, void, AnyAction>,
    getState: () => RootImportState
  ) => {
    const state = getState();
    const {
      ns,
      dataService: { dataService },
      importData,
    } = state;
    const {
      fileName,
      fileType,
      fileIsMultilineJSON,
      fileStats,
      delimiter,
      ignoreBlanks: ignoreBlanks_,
      stopOnErrors,
      exclude,
      transform,
    } = importData;
    const ignoreBlanks = ignoreBlanks_ && fileType === FILE_TYPES.CSV;
    const fileSize = fileStats?.size || 0;

    log.info(
      mongoLogId(1001000080),
      'Import',
      'Start reading from source file',
      {
        ns,
        fileName,
        fileType,
        fileIsMultilineJSON,
        fileSize,
        delimiter,
        ignoreBlanks,
        stopOnErrors,
        exclude,
        transform,
      }
    );
    const source = fs.createReadStream(fileName, 'utf8');

    const stripBOM = stripBomStream();

    const parser = createParser({
      fileName,
      fileType,
      delimiter,
      fileIsMultilineJSON,
    });

    const applyTypes = transformProjectedTypesStream({
      exclude,
      transform,
      ignoreBlanks,
    });

    const dest = createCollectionWriteStream(dataService!, ns, stopOnErrors);

    dest.on('progress', (stats: CollectionStreamProgress) => {
      dispatch(onProgress(stats));
    });

    const progress = createProgressStream(
      fileSize,
      function (
        err: Error | undefined,
        info: {
          percentage: number;
          transferred: number;
          length: number;
          remaining: number;
          eta: number;
          runtime: number;
          delta: number;
          speed: number;
        }
      ) {
        if (err) return;
        dispatch(onGuesstimatedProgress(info.transferred, info.length));
      }
    );

    const importSizeGuesstimator = createImportSizeGuesstimator(
      source,
      fileSize,
      function (err: Error | undefined, guesstimatedTotalDocs: number) {
        if (err) return;
        progress.setLength(guesstimatedTotalDocs);
        dispatch(onGuesstimatedDocsTotal(guesstimatedTotalDocs));
      }
    );

    console.time('import');
    console.group('import:start');

    console.group('Import Options:');
    console.table({
      fileName,
      fileType,
      fileIsMultilineJSON,
      fileSize,
      delimiter,
      ignoreBlanks,
      stopOnErrors,
    });

    console.log('Exclude');
    console.table(exclude);

    console.log('Transform');
    console.table(transform);

    console.log('Running import...');

    dispatch(onStarted(source, dest));

    stream.pipeline(
      source,
      stripBOM,
      parser,
      applyTypes,
      importSizeGuesstimator,
      progress,
      dest,
      function onStreamEnd(err) {
        console.timeEnd('import');
        track('Import Completed', {
          file_type: fileType,
          all_fields: exclude.length === 0,
          stop_on_error_selected: stopOnErrors,
          number_of_docs: dest.docsWritten,
          success: !err,
        });
        /**
         * TODO: lucas: Decorate with a codeframe if not already
         * json parsing errors already are.
         */
        if (err) {
          log.error(mongoLogId(1001000081), 'Import', 'Import failed', {
            ns,
            docsWritten: dest.docsWritten,
            error: err.message,
          });
          debug('Error while importing:', err.stack);

          console.groupEnd();
          console.groupEnd();

          return dispatch(onFailed(err));
        }
        log.info(mongoLogId(1001000082), 'Import', 'Import completed', {
          ns,
          docsWritten: dest.docsWritten,
          docsProcessed: dest.docsProcessed,
        });

        dispatch(onFinished(dest.docsWritten, dest.docsProcessed));

        const payload = {
          ns,
          size: fileSize,
          fileType,
          docsWritten: dest.docsWritten,
          fileIsMultilineJSON,
          delimiter,
          ignoreBlanks,
          stopOnErrors,
          hasExcluded: exclude.length > 0,
          hasTransformed: transform.length > 0,
        };
        dispatch(globalAppRegistryEmit('import-finished', payload));
        console.groupEnd();
        console.groupEnd();
      }
    );
  };
};

/**
 * Cancels an active import if there is one, noop if not.
 *
 * @api public
 */
export const cancelImport = () => {
  return (
    dispatch: ThunkDispatch<RootImportState, void, AnyAction>,
    getState: () => RootImportState
  ) => {
    const { importData } = getState();
    const { source, dest } = importData;

    if (!source || !dest) {
      debug('no active import to cancel.');
      return;
    }
    debug('cancelling');
    source.unpipe();

    debug('import canceled by user');
    dispatch({ type: CANCELED });
  };
};

/**
 * Load a preview of the first few documents in the selected file
 * which is used to calculate an inital set of `fields` and `values`.
 *
 * `loadPreviewDocs()` is only called internally when any state used
 * for specifying import parsing is modified.
 */
const loadPreviewDocs = (
  fileName: string,
  fileType: 'json' | 'csv' | '',
  delimiter: string,
  fileIsMultilineJSON: boolean
): ThunkAction<void, RootImportState, void, AnyAction> => {
  return (dispatch: Dispatch): void => {
    debug('loading preview', {
      fileName,
      fileType,
      delimiter,
      fileIsMultilineJSON,
    });
    /**
     * TODO: lucas: add dispatches for preview loading, error, etc.
     * as needed. For the time being, its fast enough and we want
     * errors/faults hard so we can figure out edge cases that
     * actually need it.
     */
    const source = fs.createReadStream(fileName, {
      encoding: 'utf8',
      end: 20 * 1024,
    });
    const stripBOM = stripBomStream();

    const dest = createPreviewWritable({
      fileType,
    });

    stream.pipeline(
      source,
      stripBOM,
      createPeekStream(fileType, delimiter, fileIsMultilineJSON),
      dest,
      function (err: Error | null) {
        if (err) {
          log.error(
            mongoLogId(1001000097),
            'Import',
            'Failed to load preview docs',
            err
          );
          debug('Error while loading preview docs:', err.stack);
          return;
        }
        dispatch({
          type: SET_PREVIEW,
          fields: dest.fields,
          values: dest.values,
        });
      }
    );
  };
};

/**
 * ### User actions for speficying import options
 */

/**
 * Mark a field to be included or excluded from the import.
 *
 * @param {String} path Dot notation path of the field.
 * @api public
 */
export const toggleIncludeField = (path: string) => ({
  type: TOGGLE_INCLUDE_FIELD,
  path: path,
});

/**
 * Specify the `type` values at `path` should be cast to.
 *
 * @param {String} path Dot notation accessor for value.
 * @param {String} bsonType A bson type identifier.
 * @example
 * ```javascript
 * //  Cast string _id from a csv to a bson.ObjectID
 * setFieldType('_id', 'ObjectID');
 * // Cast `{stats: {flufiness: "100"}}` to
 * // `{stats: {flufiness: 100}}`
 * setFieldType('stats.flufiness', 'Int32');
 * ```
 */
export const setFieldType = (path: string, bsonType: string) => {
  return {
    type: SET_FIELD_TYPE,
    path: path,
    bsonType: bsonType,
  };
};

/**
 * Gather file metadata quickly when the user specifies `fileName`
 * @see utils/detect-import-file.js
 */
export const selectImportFileName = (fileName: string) => {
  return async (
    dispatch: ThunkDispatch<RootImportState, void, AnyAction>,
    getState: () => RootImportState
  ) => {
    let fileStats = {};
    try {
      const exists = await checkFileExists(fileName);
      if (!exists) {
        throw new Error(`File ${fileName} not found`);
      }
      const stats = await getFileStats(fileName);

      fileStats = {
        ...stats,
        type: mime.lookup(fileName),
      };
      const detected = (await promisify(detectImportFile)(fileName)) as {
        fileName: string;
        fileIsMultilineJSON: boolean;
        fileType: AcceptedFileType;
      };
      debug('get detection results');
      dispatch({
        type: FILE_SELECTED,
        fileName: fileName,
        fileStats: fileStats,
        fileIsMultilineJSON: detected.fileIsMultilineJSON,
        fileType: detected.fileType,
      });

      /**
       * TODO: lucas: @see utils/detect-import-file.js for future delimiter detection.
       */
      const delimiter = getState().importData.delimiter;
      dispatch(
        loadPreviewDocs(
          fileName,
          detected.fileType,
          delimiter,
          detected.fileIsMultilineJSON
        )
      );
    } catch (err: any) {
      debug('dispatching error', err?.stack);
      dispatch(onFailed(err));
    }
  };
};

/**
 * The user has manually selected the `fileType` of the import.
 */
export const selectImportFileType = (fileType: 'json' | 'csv') => {
  return (
    dispatch: ThunkDispatch<RootImportState, void, AnyAction>,
    getState: () => RootImportState
  ) => {
    const { previewLoaded, fileName, delimiter, fileIsMultilineJSON } =
      getState().importData;

    dispatch({
      type: FILE_TYPE_SELECTED,
      fileType: fileType,
    });

    if (previewLoaded) {
      debug('preview needs updated because fileType changed');
      dispatch(
        loadPreviewDocs(fileName, fileType, delimiter, fileIsMultilineJSON)
      );
    }
  };
};

/**
 * Set the tabular delimiter.
 */
export const setDelimiter = (delimiter: string) => {
  return (
    dispatch: ThunkDispatch<RootImportState, void, AnyAction>,
    getState: () => RootImportState
  ) => {
    const { previewLoaded, fileName, fileType, fileIsMultilineJSON } =
      getState().importData;
    dispatch({
      type: SET_DELIMITER,
      delimiter: delimiter,
    });

    if (previewLoaded) {
      debug('preview needs updated because delimiter changed', {
        fileName,
        fileType,
        delimiter,
        fileIsMultilineJSON,
      });
      dispatch(
        loadPreviewDocs(fileName, fileType, delimiter, fileIsMultilineJSON)
      );
    }
  };
};

/**
 * Stop the import if mongo returns an error for a document write
 * such as a duplicate key for a unique index. In practice,
 * the cases for this being false when importing are very minimal.
 * For example, a duplicate unique key on _id is almost always caused
 * by the user attempting to resume from a previous import without
 * removing all documents sucessfully imported.
 *
 * @see utils/collection-stream.js
 * @see https://www.mongodb.com/docs/database-tools/mongoimport/#std-option-mongoimport.--stopOnError
 */
export const setStopOnErrors = (stopOnErrors: boolean) => ({
  type: SET_STOP_ON_ERRORS,
  stopOnErrors: stopOnErrors,
});

/**
 * Any `value` that is `''` will not have this field set in the final
 * document written to mongo.
 *
 * @see https://www.mongodb.com/docs/database-tools/mongoimport/#std-option-mongoimport.--ignoreBlanks
 */
export const setIgnoreBlanks = (ignoreBlanks: boolean) => ({
  type: SET_IGNORE_BLANKS,
  ignoreBlanks: ignoreBlanks,
});

/**
 * ### Top-level modal visibility
 */

/**
 * Open the import modal.
 */
export const openImport =
  (namespace: string) =>
  (dispatch: ThunkDispatch<RootImportState, void, AnyAction>) => {
    track('Import Opened');
    dispatch(nsChanged(namespace));
    dispatch({ type: OPEN });
  };

/**
 * Close the import modal.
 * @api public
 */
export const closeImport = () => ({
  type: CLOSE,
});

/**
 * The import module reducer.
 */
const reducer = (state = INITIAL_STATE, action: AnyAction): State => {
  debug('reducer handling action', action.type);
  if (action.type === FILE_SELECTED) {
    return {
      ...state,
      fileName: action.fileName,
      fileType: action.fileType,
      fileStats: action.fileStats,
      fileIsMultilineJSON: action.fileIsMultilineJSON,
      status: PROCESS_STATUS.UNSPECIFIED,
      docsTotal: -1,
      docsProcessed: 0,
      docsWritten: 0,
      guesstimatedDocsTotal: 0,
      guesstimatedDocsProcessed: 0,
      errors: [],
      source: undefined,
      dest: undefined,
      fields: [],
    };
  }

  /**
   * ## Options
   */
  if (action.type === FILE_TYPE_SELECTED) {
    return {
      ...state,
      fileType: action.fileType,
    };
  }

  if (action.type === SET_STOP_ON_ERRORS) {
    return {
      ...state,
      stopOnErrors: action.stopOnErrors,
    };
  }

  if (action.type === SET_IGNORE_BLANKS) {
    return {
      ...state,
      ignoreBlanks: action.ignoreBlanks,
    };
  }

  if (action.type === SET_DELIMITER) {
    return {
      ...state,
      delimiter: action.delimiter,
    };
  }

  /**
   * ## Preview and projection/data type options
   */
  if (action.type === SET_PREVIEW) {
    const newState = {
      ...state,
      values: action.values,
      fields: action.fields,
      previewLoaded: true,
      exclude: [],
    };

    newState.transform = newState.fields
      .filter((field: FieldType) => field.checked)
      .map((field: FieldType) => [field.path, field.type]);

    return newState;
  }
  /**
   * When checkbox next to a field is checked/unchecked
   */
  if (action.type === TOGGLE_INCLUDE_FIELD) {
    /**
     * TODO: lucas: Move away from `state.fields` being
     * array of objects to using all array's of strings.
     * For now, there is some duplication of fields+transform+exclude
     * we'll come back to and fixup.
     */
    const newState = {
      ...state,
    };

    newState.fields = newState.fields.map((field) => {
      if (field.path === action.path) {
        field.checked = !field.checked;
      }
      return field;
    });

    newState.transform = newState.fields.map((field) => [
      field.path,
      field.type,
    ]);

    newState.exclude = newState.fields
      .filter((field) => !field.checked)
      .map((field) => field.path);

    return newState;
  }

  /**
   * Changing field type from a select dropdown.
   */
  if (action.type === SET_FIELD_TYPE) {
    const newState = {
      ...state,
    };

    newState.fields = newState.fields.map((field) => {
      if (field.path === action.path) {
        // If a user changes a field type, automatically check it for them
        // so they don't need an extra click or forget to click it an get frustrated
        // like I did so many times :)
        field.checked = true;
        field.type = action.bsonType;
      }
      return field;
    });

    newState.exclude = newState.fields
      .filter((field) => !field.checked)
      .map((field) => field.path);

    newState.transform = newState.fields
      .filter((field) => field.checked)
      .map((field) => [field.path, field.type]);

    return newState;
  }

  /**
   * ## Status/Progress
   */
  if (action.type === FAILED) {
    return {
      ...state,
      // In cases where `FAILED` happened on import it might emit an event with
      // an error that was already saved in the `errors` array. We want to avoid
      // that by checking if the error is there before storing it in the state
      errors: state.errors.includes(action.error)
        ? state.errors
        : state.errors.concat(action.error),
      status: PROCESS_STATUS.FAILED,
    };
  }

  if (action.type === STARTED) {
    return {
      ...state,
      errors: [],
      docsTotal: -1,
      docsProcessed: 0,
      docsWritten: 0,
      guesstimatedDocsTotal: 0,
      guesstimatedDocsProcessed: 0,
      status: PROCESS_STATUS.STARTED,
      source: action.source,
      dest: action.dest,
    };
  }

  if (action.type === SET_GUESSTIMATED_TOTAL) {
    return {
      ...state,
      guesstimatedDocsTotal: action.guesstimatedDocsTotal,
    };
  }

  if (action.type === GUESSTIMATED_PROGRESS) {
    return {
      ...state,
      guesstimatedDocsProcessed: action.guesstimatedDocsProcessed,
      guesstimatedDocsTotal: action.guesstimatedDocsTotal,
    };
  }

  if (action.type === PROGRESS) {
    return {
      ...state,
      docsWritten: action.docsWritten,
      docsProcessed: action.docsProcessed,
      errors: action.errors,
    };
  }

  if (action.type === FINISHED) {
    const isComplete = state.status !== PROCESS_STATUS.CANCELED;
    const hasErrors = (state.errors || []).length > 0;

    let status = state.status;

    if (isComplete && hasErrors) {
      status = PROCESS_STATUS.COMPLETED_WITH_ERRORS;
    } else if (isComplete) {
      status = PROCESS_STATUS.COMPLETED;
    }

    return {
      ...state,
      status,
      docsWritten: action.docsWritten,
      docsTotal: action.docsTotal,
      source: undefined,
      dest: undefined,
    };
  }

  if (action.type === CANCELED) {
    return {
      ...state,
      status: PROCESS_STATUS.CANCELED,
      source: undefined,
      dest: undefined,
    };
  }

  /**
   * Open the `<ImportModal />`
   */
  if (action.type === OPEN) {
    return {
      ...INITIAL_STATE,
      isOpen: true,
    };
  }

  if (action.type === CLOSE) {
    return {
      ...state,
      isOpen: false,
    };
  }
  return state;
};
export default reducer;
