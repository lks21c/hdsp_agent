/**
 * Explain Button Component
 * Triggers explanation of cell code
 */

import React from 'react';

export interface IExplainButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const ExplainButton: React.FC<IExplainButtonProps> = ({
  onClick,
  disabled = false
}) => {
  return (
    <button
      className="jp-agent-button jp-agent-button-explain"
      onClick={onClick}
      disabled={disabled}
      title="Explain this code"
      aria-label="Explain code"
    >
      E
    </button>
  );
};
