/**
 * Jupyter Agent Extension Entry Point
 */

import {
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

// Import plugins
import { sidebarPlugin } from './plugins/sidebar-plugin';
import { cellButtonsPlugin } from './plugins/cell-buttons-plugin';
import { promptGenerationPlugin } from './plugins/prompt-generation-plugin';

// Import styles
import '../style/index.css';

/**
 * The main plugin export
 * Note: sidebarPlugin must load before cellButtonsPlugin
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  sidebarPlugin,
  cellButtonsPlugin,
  promptGenerationPlugin
];

export default plugins;
