/**
 * Custom Prompt Button Component
 * Opens dialog for custom prompt input
 */

import React from 'react';

export interface ICustomPromptButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const CustomPromptButton: React.FC<ICustomPromptButtonProps> = ({
  onClick,
  disabled = false
}) => {
  return (
    <button
      className="jp-agent-button jp-agent-button-custom"
      onClick={onClick}
      disabled={disabled}
      title="Custom prompt"
      aria-label="Custom prompt for code"
    >
      ?
    </button>
  );
};
