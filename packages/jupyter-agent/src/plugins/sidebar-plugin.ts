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

import { AgentPanelWidget } from '../components/AgentPanel';
import { ApiService } from '../services/ApiService';

/**
 * Sidebar plugin namespace
 */
const PLUGIN_ID = '@jupyter-agent/sidebar';
const COMMAND_ID = 'jupyter-agent:toggle-sidebar';

/**
 * Agent Sidebar Plugin
 */
export const sidebarPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [],
  optional: [ILayoutRestorer, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    restorer: ILayoutRestorer | null,
    palette: ICommandPalette | null
  ) => {
    console.log('[SidebarPlugin] Activating Jupyter Agent Sidebar');

    try {
      // Create API service
      const apiService = new ApiService();

      // Create agent panel widget
      const agentPanel = new AgentPanelWidget(apiService);

      // Create tracker for panel state restoration if restorer available
      if (restorer) {
        const tracker = new WidgetTracker<AgentPanelWidget>({
          namespace: 'jupyter-agent'
        });

        // Add panel to tracker
        tracker.add(agentPanel);

        // Restore panel state
        restorer.restore(tracker, {
          command: COMMAND_ID,
          name: () => 'jupyter-agent'
        });
      }

    // Add panel to right sidebar
    app.shell.add(agentPanel, 'right', { rank: 100 });

    // Add command to toggle sidebar
    app.commands.addCommand(COMMAND_ID, {
      label: 'HDSP Agent 사이드바 토글',
      caption: 'HDSP Agent 패널 표시/숨기기',
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
        category: 'HDSP Agent',
        args: {}
      });
    }

      // Store reference globally for cell buttons to access
      (window as any)._jupyterAgentPanel = agentPanel;

      console.log('[SidebarPlugin] HDSP Agent Sidebar activated successfully');
    } catch (error) {
      console.error('[SidebarPlugin] Failed to activate:', error);
    }
  }
};
