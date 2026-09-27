import { render } from 'solid-js/web';
import { App } from './App.tsx';

import './app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

render(() => <App />, container);
