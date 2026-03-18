import { mountProtectedPage } from '../bootstrap/mountPage';
import LogsView from '../views/logs/LogsView.vue';

void mountProtectedPage({
  component: LogsView,
  currentPath: '/logs',
  title: '运行日志'
});
