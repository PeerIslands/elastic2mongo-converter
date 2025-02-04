import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { palette, withTheme } from '@mongodb-js/compass-components';

const UnthemedZeroGraphic = ({
  darkMode,
}) => {
  const strokeColor = useMemo(
    () => (darkMode ? palette.white : palette.black),
    [darkMode]
  );

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M68 31.975H65.8901M65.8901 31.975C62.7253 31.975 60.2637 34.425 60.2637 37.575V55.775C60.2637 60.325 56.5714 64 52 64H20C15.4286 64 11.7363 60.325 11.7363 55.775V37.575C11.7363 34.425 9.27472 31.975 6.10989 31.975M65.8901 31.975C62.7253 31.975 60.2637 29.525 60.2637 26.375V16.225C60.2637 11.675 56.5714 8 52 8H20C15.4286 8 11.7363 11.675 11.7363 16.225V26.375C11.7363 29.525 9.27472 31.975 6.10989 31.975M6.10989 31.975H4M20 11.0331C20 11.0331 34.0659 15.0771 52 11.0331" stroke={strokeColor} strokeMiterlimit="10"/>
      <path d="M24 36.1318C24 42.7318 29.4 48.1318 36 48.1318C42.6 48.1318 48 42.7318 48 36.1318C48 29.5318 42.6 24.1318 36 24.1318C29.4 24.1318 24 29.5318 24 36.1318Z" fill={palette.green.base} stroke={strokeColor} strokeMiterlimit="10"/>
      <path d="M31 36.1318H31.3982M31.3982 36.1318C31.9735 36.1318 32.4159 36.5718 32.4159 37.0518V38.7718C32.4159 39.5318 33.0797 40.1318 33.9204 40.1318M31.3982 36.1318C31.9735 36.1318 32.4161 35.6919 32.4161 35.2119V33.4919C32.4161 32.7318 33.0798 32.1318 33.9205 32.1318M41 36.1318H40.6018M40.6018 36.1318C40.0265 36.1318 39.5841 36.5718 39.5841 37.0518V38.7718C39.5841 39.5318 38.9203 40.1318 38.0796 40.1318M40.6018 36.1318C40.0265 36.1318 39.5841 35.6919 39.5841 35.2119V33.4919C39.5841 32.7318 38.9203 32.1318 38.0796 32.1318" stroke={strokeColor} strokeMiterlimit="10"/>
    </svg>
  );
};

UnthemedZeroGraphic.propTypes = {
  darkMode: PropTypes.boolean
};

const ZeroGraphic = withTheme(
  UnthemedZeroGraphic
);

export { ZeroGraphic };
