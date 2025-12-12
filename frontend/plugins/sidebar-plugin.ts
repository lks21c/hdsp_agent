/**
 * Sidebar Plugin
 * Adds Agent panel to JupyterLab sidebar
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';

import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IConsoleTracker } from '@jupyterlab/console';

import { AgentPanelWidget } from '../components/AgentPanel';
import { ApiService } from '../services/ApiService';

/**
 * Sidebar plugin namespace
 */
const PLUGIN_ID = '@hdsp-agent/sidebar';
const COMMAND_ID = 'hdsp-agent:toggle-sidebar';

/**
 * Agent Sidebar Plugin
 */
export const sidebarPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [],
  optional: [ILayoutRestorer, ICommandPalette, INotebookTracker, IConsoleTracker],
  activate: (
    app: JupyterFrontEnd,
    restorer: ILayoutRestorer | null,
    palette: ICommandPalette | null,
    notebookTracker: INotebookTracker | null,
    consoleTracker: IConsoleTracker | null
  ) => {
    console.log('[SidebarPlugin] Activating Jupyter Agent Sidebar');

    try {
      // Create API service
      const apiService = new ApiService();

      // Create agent panel widget with notebook tracker and console tracker
      const agentPanel = new AgentPanelWidget(apiService, notebookTracker, consoleTracker);

      // Create tracker for panel state restoration if restorer available
      if (restorer) {
        const tracker = new WidgetTracker<AgentPanelWidget>({
          namespace: 'hdsp-agent'
        });

        // Add panel to tracker
        tracker.add(agentPanel);

        // Restore panel state
        restorer.restore(tracker, {
          command: COMMAND_ID,
          name: () => 'hdsp-agent'
        });
      }

    // Add panel to right sidebar
    app.shell.add(agentPanel, 'right', { rank: 100 });

    // Add command to toggle sidebar
    app.commands.addCommand(COMMAND_ID, {
      label: 'HALO Agent 사이드바 토글',
      caption: 'HALO Agent 패널 표시/숨기기',
      execute: () => {
        if (agentPanel.isVisible) {
          agentPanel.close();
        } else {
          app.shell.activateById(agentPanel.id);
        }
      }
    });

    // Add command to palette
    if (palette) {
      palette.addItem({
        command: COMMAND_ID,
        category: 'HALO Agent',
        args: {}
      });
    }

      // Store reference globally for cell buttons to access
      (window as any)._hdspAgentPanel = agentPanel;

      console.log('[SidebarPlugin] HALO Agent Sidebar activated successfully');
    } catch (error) {
      console.error('[SidebarPlugin] Failed to activate:', error);
    }
  }
};
