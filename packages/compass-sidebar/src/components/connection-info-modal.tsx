import React from 'react';
import { connect } from 'react-redux';
import { Modal, H3, Body, css, spacing } from '@mongodb-js/compass-components';
import { ServerType, TopologyType } from 'mongodb-instance-model';
import type { MongoDBInstance } from 'mongodb-instance-model';
import type { ConnectionOptions } from '../modules/connection-options';
import { ENTERPRISE, COMMUNITY } from '../constants/server-version';

type ConnectionInfo = {
  term: string;
  description: React.ReactChild;
};

const infoContainer = css({
  margin: `${spacing[3]}px 0`,
});

function InfoTerm({ children }: { children: React.ReactChild }) {
  return <Body weight="medium">{children}</Body>;
}
function InfoDescription({ children }: { children: React.ReactChild }) {
  return <Body>{children}</Body>;
}

function Info({
  term,
  children,
}: {
  term: React.ReactChild;
  children: React.ReactChild;
}) {
  return (
    <div className={infoContainer}>
      <dt>
        <InfoTerm>{term}</InfoTerm>
      </dt>
      <dd>
        <InfoDescription>{children}</InfoDescription>
      </dd>
    </div>
  );
}

export function ConnectionInfoModal({
  isVisible,
  close,
  infos,
}: {
  isVisible: boolean;
  close: () => void;
  infos: ConnectionInfo[];
}) {
  return (
    <Modal open={isVisible} setOpen={close} size="small">
      <H3>Connection info</H3>

      <dl>
        {infos.map((info, i) => (
          <Info key={i} term={info.term}>
            {info.description}
          </Info>
        ))}
      </dl>
    </Modal>
  );
}

function getVersionDistro(isEnterprise?: boolean): string {
  // it is unknown until instance details are loaded
  if (typeof isEnterprise === 'undefined') {
    return '';
  }

  return isEnterprise ? ENTERPRISE : COMMUNITY;
}

type InfoParameters = {
  instance: MongoDBInstance;
  connectionInfo: ConnectionInfo;
  connectionOptions: ConnectionOptions;
};

function getHostInfo({ instance }: InfoParameters): ConnectionInfo {
  const { type, servers } = instance.topologyDescription;

  let heading = servers.length === 1 ? 'Host' : 'Hosts';
  if (type === TopologyType.LOAD_BALANCED) {
    heading += ' (Load Balancer)';
  }

  const hosts =
    servers.length === 1 ? (
      servers[0].address
    ) : (
      <div>
        {servers.map((server, i) => (
          <div key={i}>{server.address}</div>
        ))}
      </div>
    );

  return {
    term: heading,
    description: hosts,
  };
}

function makeNodesInfo(
  numNodes: number,
  single: string,
  plural: string
): string {
  return numNodes === 1 ? `1 ${single}` : `${numNodes} ${plural}`;
}

function getClusterInfo({ instance }: InfoParameters): ConnectionInfo {
  const { type, setName, servers } = instance.topologyDescription;

  let clusterType: string;
  let nodesInfo;
  switch (type) {
    case TopologyType.SHARDED:
      clusterType = 'Sharded';
      nodesInfo = makeNodesInfo(servers.length, 'Mongos', 'Mongoses');
      break;

    case TopologyType.REPLICA_SET_NO_PRIMARY:
    case TopologyType.REPLICA_SET_WITH_PRIMARY:
      clusterType = `Replica Set ${setName}`;
      nodesInfo = makeNodesInfo(servers.length, 'Node', 'Nodes');
      break;

    default:
      clusterType = ServerType.humanize(servers[0].type);
      break;
  }

  return {
    term: 'Cluster',
    description: nodesInfo ? (
      <div>
        <div>{clusterType}</div>
        <div>{nodesInfo}</div>
      </div>
    ) : (
      clusterType
    ),
  };
}

function getVersionInfo({ instance }: InfoParameters): ConnectionInfo {
  return {
    term: 'Edition',
    description: instance.dataLake.isDataLake
      ? `Atlas Data Federation ${instance.dataLake.version ?? ''}`
      : `MongoDB ${instance.build.version} ${getVersionDistro(
          instance.build.isEnterprise
        )}`,
  };
}

function getSSHTunnelInfo({
  connectionOptions,
}: InfoParameters): ConnectionInfo {
  const { sshTunnelHostPortString } = connectionOptions;
  return {
    term: 'SSH Connection Via',
    description: sshTunnelHostPortString,
  };
}

function getInfos(infoParameters: InfoParameters) {
  const infos: ConnectionInfo[] = [];

  const { instance, connectionOptions } = infoParameters;

  if (!instance) {
    return infos;
  }

  infos.push(getHostInfo(infoParameters));

  if (
    instance.dataLake.isDataLake === false &&
    instance.topologyDescription.type !== TopologyType.LOAD_BALANCED
  ) {
    infos.push(getClusterInfo(infoParameters));
  }

  infos.push(getVersionInfo(infoParameters));

  if (connectionOptions.sshTunnel) {
    infos.push(getSSHTunnelInfo(infoParameters));
  }

  return infos;
}

const mapStateToProps = (state: {
  instance: MongoDBInstance;
  connectionInfo: {
    connectionInfo: ConnectionInfo;
  };
  connectionOptions: ConnectionOptions;
}) => {
  const { instance, connectionOptions } = state;
  const { connectionInfo } = state.connectionInfo;

  return {
    infos: getInfos({ instance, connectionInfo, connectionOptions }),
  };
};

const MappedConnectionInfoModal = connect(
  mapStateToProps,
  {}
)(ConnectionInfoModal);

export default MappedConnectionInfoModal;
