export { createApp, startServer } from './app';

import { startServer } from './app';

if (require.main === module) {
  void startServer();
}
