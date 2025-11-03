/**
 * Prompt Generation Plugin
 * Adds "프롬프트 생성" to Jupyter Launcher
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ILauncher } from '@jupyterlab/launcher';
import { ICommandPalette, ReactWidget, Notification } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { LabIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';

import React, { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material';

import hdspIconSvg from '../../style/icons/hdsp-icon.svg';

import { PromptGenerationDialog } from '../components/PromptGenerationDialog';
import { TaskProgressWidget } from '../components/TaskProgressWidget';
import { TaskService } from '../services/TaskService';
import { ITaskStatus } from '../types';

/**
 * Plugin constants
 */
const PLUGIN_ID = '@jupyter-agent/prompt-generation';
const COMMAND_ID = 'jupyter-agent:generate-from-prompt';
const CATEGORY = 'HDSP Agent';

/**
 * HDSP Icon
 */
const hdspIcon = new LabIcon({
  name: 'jupyter-agent:hdsp-icon',
  svgstr: hdspIconSvg
});

/**
 * Task Manager Widget
 * Manages active notebook generation tasks
 */
class TaskManagerWidget extends ReactWidget {
  private taskService: TaskService;
  private activeTasks: Map<string, ITaskStatus>;
  private docManager: IDocumentManager;
  private app: JupyterFrontEnd;

  constructor(app: JupyterFrontEnd, docManager: IDocumentManager) {
    super();
    this.app = app;
    this.docManager = docManager;
    this.taskService = new TaskService();
    this.activeTasks = new Map();
    this.addClass('jp-TaskManagerWidget');
  }

  /**
   * Start a new notebook generation task
   */
  async startGeneration(prompt: string): Promise<void> {
    try {
      // Start generation
      const response = await this.taskService.generateNotebook({ prompt });
      const taskId = response.taskId;

      // Subscribe to progress
      this.taskService.subscribeToTaskProgress(
        taskId,
        (status) => {
          this.activeTasks.set(taskId, status);
          this.update();

          // Show notification on completion
          if (status.status === 'completed' && status.notebookPath) {
            Notification.success(
              `노트북 생성 완료: ${status.notebookPath.split('/').pop()}`,
              {
                autoClose: 5000
              }
            );
          } else if (status.status === 'failed') {
            Notification.error(`노트북 생성 실패: ${status.error}`, {
              autoClose: 10000
            });
          }
        },
        (error) => {
          console.error('Task progress error:', error);
          Notification.error('진행상황 연결 실패', { autoClose: 5000 });
        },
        () => {
          // Task completed, keep in list for user to review
          this.update();
        }
      );

      // Show initial notification
      Notification.info('노트북 생성을 시작했습니다', { autoClose: 3000 });
      this.update();
    } catch (error: any) {
      console.error('Failed to start generation:', error);
      Notification.error(`생성 시작 실패: ${error.message}`, {
        autoClose: 5000
      });
    }
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    try {
      await this.taskService.cancelTask(taskId);
      this.activeTasks.delete(taskId);
      this.update();
      Notification.info('작업을 취소했습니다', { autoClose: 3000 });
    } catch (error: any) {
      console.error('Failed to cancel task:', error);
      Notification.error(`취소 실패: ${error.message}`, { autoClose: 5000 });
    }
  }

  /**
   * Close/remove task from display
   */
  closeTask(taskId: string): void {
    this.taskService.unsubscribeFromTask(taskId);
    this.activeTasks.delete(taskId);
    this.update();
  }

  /**
   * Open generated notebook
   */
  async openNotebook(notebookPath: string, taskId: string): Promise<void> {
    try {
      // Extract just the filename from the path
      const filename = notebookPath.split('/').pop() || notebookPath;

      // Open the notebook
      await this.docManager.openOrReveal(filename);

      // Close the task widget after opening
      this.closeTask(taskId);

      Notification.success(`노트북을 열었습니다: ${filename}`, {
        autoClose: 3000
      });
    } catch (error: any) {
      console.error('Failed to open notebook:', error);
      Notification.error(`노트북 열기 실패: ${error.message}`, {
        autoClose: 5000
      });
    }
  }

  render(): JSX.Element {
    const theme = createTheme();
    const tasks = Array.from(this.activeTasks.entries());

    return (
      <ThemeProvider theme={theme}>
        <div style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 1300 }}>
          {tasks.map(([taskId, status], index) => (
            <div
              key={taskId}
              style={{
                marginBottom: index < tasks.length - 1 ? '10px' : '0'
              }}
            >
              <TaskProgressWidget
                taskStatus={status}
                onClose={() => this.closeTask(taskId)}
                onCancel={() => this.cancelTask(taskId)}
                onOpenNotebook={() =>
                  status.notebookPath &&
                  this.openNotebook(status.notebookPath, taskId)
                }
              />
            </div>
          ))}
        </div>
      </ThemeProvider>
    );
  }

  dispose(): void {
    this.taskService.dispose();
    super.dispose();
  }
}

/**
 * Dialog Widget for prompt input
 */
class PromptDialogWidget extends ReactWidget {
  private _onGenerate: (prompt: string) => void;
  private _onClose: () => void;

  constructor(onGenerate: (prompt: string) => void, onClose: () => void) {
    super();
    this._onGenerate = onGenerate;
    this._onClose = onClose;
  }

  render(): JSX.Element {
    const theme = createTheme();

    return (
      <ThemeProvider theme={theme}>
        <PromptGenerationDialog
          open={true}
          onClose={this._onClose}
          onGenerate={this._onGenerate}
        />
      </ThemeProvider>
    );
  }
}

/**
 * Prompt Generation Plugin
 */
export const promptGenerationPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [IDocumentManager],
  optional: [ILauncher, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    launcher: ILauncher | null,
    palette: ICommandPalette | null
  ) => {
    console.log('[PromptGenerationPlugin] Activating');

    try {
      // Create task manager widget
      const taskManager = new TaskManagerWidget(app, docManager);
      taskManager.id = 'jupyter-agent-task-manager';
      taskManager.title.label = 'Task Manager';

      // Add to shell but keep it as a floating overlay (not in main area)
      // The widget renders itself as a fixed position element
      Widget.attach(taskManager, document.body);

      // Add command
      app.commands.addCommand(COMMAND_ID, {
        label: 'HDSP',
        caption: '프롬프트로 노트북 생성',
        icon: hdspIcon,
        execute: () => {
          // Create dialog widget
          let dialogWidget: PromptDialogWidget | null = null;

          const onGenerate = async (prompt: string) => {
            if (dialogWidget) {
              dialogWidget.dispose();
              dialogWidget = null;
            }
            await taskManager.startGeneration(prompt);
          };

          const onClose = () => {
            if (dialogWidget) {
              dialogWidget.dispose();
              dialogWidget = null;
            }
          };

          dialogWidget = new PromptDialogWidget(onGenerate, onClose);
          dialogWidget.id = 'jupyter-agent-prompt-dialog';
          dialogWidget.title.label = '';

          app.shell.add(dialogWidget, 'main');
        }
      });

      // Add to launcher
      if (launcher) {
        launcher.add({
          command: COMMAND_ID,
          category: 'Notebook',
          rank: 1
        });
      }

      // Add to command palette
      if (palette) {
        palette.addItem({
          command: COMMAND_ID,
          category: CATEGORY
        });
      }

      console.log('[PromptGenerationPlugin] Activated successfully');
    } catch (error) {
      console.error('[PromptGenerationPlugin] Failed to activate:', error);
    }
  }
};
