import { mount } from 'svelte';
import App from './App.svelte';

import './app.css';

const target = document.getElementById('root');
if (!target) throw new Error('Missing #root element');

mount(App, { target });
