import {
  css,
  Subtitle,
  palette,
  cx,
  withTheme,
} from '@mongodb-js/compass-components';
import React from 'react';

const collectionHeaderActionsReadonlyStyles = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  alignItems: 'inherit',
  fontWeight: 'normal',
});

const collectionHeaderActionsReadonlyLightStyles = css({
  color: palette.gray.dark1,
});

const collectionHeaderActionsReadonlyDarkStyles = css({
  color: palette.gray.light1,
});

type ViewInformationProps = {
  darkMode?: boolean;
  sourceName: string;
};

const ViewInformation: React.FunctionComponent<ViewInformationProps> = ({
  darkMode,
  sourceName,
}: ViewInformationProps) => {
  return (
    <Subtitle
      data-testid="collection-view-on"
      className={cx(
        collectionHeaderActionsReadonlyStyles,
        darkMode
          ? collectionHeaderActionsReadonlyDarkStyles
          : collectionHeaderActionsReadonlyLightStyles
      )}
      title={sourceName}
    >
      view on: {sourceName}
    </Subtitle>
  );
};

export default withTheme(ViewInformation);
