import { TimelineRoot } from '@editframe/react';
import ReactDOM from 'react-dom/client';
import { Video } from './Video';
import '@editframe/elements/styles.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(<TimelineRoot id="root" component={Video} />);
