import React from 'react';
import { css } from '@leafygreen-ui/emotion';
import { palette } from '@leafygreen-ui/palette';
import { spacing } from '@leafygreen-ui/tokens';

import { Body, Subtitle } from './leafygreen';
import type { Link } from './leafygreen';

const containerStyles = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  margin: `${spacing[3]}px auto`,
  marginTop: spacing[7],
  padding: `0 ${spacing[3]}px`,
});

const iconStyles = css({
  flex: 'none',
  maxWidth: '80px',
  maxHeight: '80px',
});
const titleStyles = css({
  color: palette.green.dark2,
  marginTop: spacing[2],
});
const subTitleStyles = css({
  marginTop: spacing[2],
  maxWidth: spacing[6] * 6,
});
const callToActionStyles = css({
  marginTop: spacing[4],
  maxWidth: '600px',
});
const callToActionLinkContainerStyles = css({
  marginTop: spacing[3],
  maxWidth: '600px',
});

type EmptyContentProps = {
  icon: React.FunctionComponent;
  title: string;
  subTitle: string;
  callToAction?: string | JSX.Element;
  callToActionLink?: typeof Link;
};

const EmptyContent: React.FunctionComponent<
  EmptyContentProps & React.HTMLProps<HTMLDivElement>
> = ({ icon: Icon, title, subTitle, callToAction, callToActionLink }) => {
  return (
    <div className={containerStyles}>
      <div className={iconStyles}>
        <Icon />
      </div>
      <Subtitle className={titleStyles}>{title}</Subtitle>
      <Body className={subTitleStyles}>{subTitle}</Body>
      {!!callToAction && (
        <div className={callToActionStyles}>
          {typeof callToAction === 'string' ? (
            <Body>{callToAction}</Body>
          ) : (
            <>{callToAction}</>
          )}
        </div>
      )}
      {!!callToActionLink && (
        <div
          className={
            callToAction ? callToActionLinkContainerStyles : callToActionStyles
          }
        >
          {callToActionLink}
        </div>
      )}
    </div>
  );
};

export { EmptyContent };
