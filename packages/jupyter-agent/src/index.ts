/**
 * Jupyter Agent Extension Entry Point
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

// Import plugins
import { cellButtonsPlugin } from './plugins/cell-buttons-plugin';

// Import styles
import '../style/index.css';

/**
 * The main plugin export
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  cellButtonsPlugin
];

export default plugins;
