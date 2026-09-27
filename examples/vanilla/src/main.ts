import { TegakiEngine } from 'tegaki/core';
import bundle from 'tegaki/fonts/caveat';
import { registerTegakiElement, type TegakiElement } from 'tegaki/wc';

import './app.css';

// Web Component: define <tegaki-renderer>, then hand the element its bundle.
registerTegakiElement();
const wc = document.getElementById('wc') as TegakiElement | null;
if (!wc) throw new Error('Missing #wc element');
wc.font = bundle;

// Core engine: mount straight into a container.
const container = document.getElementById('core');
if (!container) throw new Error('Missing #core element');
new TegakiEngine(container, {
  text: 'Plain engine',
  font: bundle,
  time: { mode: 'uncontrolled', speed: 1, loop: true, loopGap: 1 },
});
