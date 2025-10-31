/**
 * Cell Action Buttons Component
 * Container for E, F, ? buttons displayed next to notebook cells
 */

import React, { useState, useCallback } from 'react';
import { Cell } from '@jupyterlab/cells';
import { CellAction, ICellActionEvent } from '../../types';
import { AgentEventEmitter, AgentEvent } from '../../utils/events';
import { ExplainButton } from './ExplainButton';
import { FixButton } from './FixButton';
import { CustomPromptButton } from './CustomPromptButton';
import { CustomPromptDialog } from './CustomPromptDialog';

export interface ICellActionButtonsProps {
  cell: Cell;
}

export const CellActionButtons: React.FC<ICellActionButtonsProps> = ({ cell }) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const getCellContent = useCallback(() => {
    return cell.model.sharedModel.getSource();
  }, [cell]);

  const emitCellAction = useCallback((type: CellAction, customPrompt?: string) => {
    const event: ICellActionEvent = {
      type,
      cellId: cell.model.id,
      cellContent: getCellContent(),
      customPrompt
    };

    AgentEventEmitter.emit(AgentEvent.CELL_ACTION, event);
  }, [cell, getCellContent]);

  const handleExplain = useCallback(() => {
    emitCellAction(CellAction.EXPLAIN);
  }, [emitCellAction]);

  const handleFix = useCallback(() => {
    emitCellAction(CellAction.FIX);
  }, [emitCellAction]);

  const handleCustomPrompt = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleDialogSubmit = useCallback((prompt: string) => {
    emitCellAction(CellAction.CUSTOM_PROMPT, prompt);
    setDialogOpen(false);
  }, [emitCellAction]);

  const handleDialogCancel = useCallback(() => {
    setDialogOpen(false);
  }, []);

  return (
    <>
      <div className="jp-agent-cell-buttons">
        <ExplainButton onClick={handleExplain} />
        <FixButton onClick={handleFix} />
        <CustomPromptButton onClick={handleCustomPrompt} />
      </div>

      <CustomPromptDialog
        isOpen={dialogOpen}
        cellContent={getCellContent()}
        onSubmit={handleDialogSubmit}
        onCancel={handleDialogCancel}
      />
    </>
  );
};
