/**
 * Fix Button Component
 * Triggers error fixing for cell code
 */

import React from 'react';

export interface IFixButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const FixButton: React.FC<IFixButtonProps> = ({
  onClick,
  disabled = false
}) => {
  return (
    <button
      className="jp-agent-button jp-agent-button-fix"
      onClick={onClick}
      disabled={disabled}
      title="Fix errors in this code"
      aria-label="Fix code errors"
    >
      F
    </button>
  );
};
