import { mountProtectedPage } from '../bootstrap/mountPage';
import SettingsView from '../views/settings/SettingsView.vue';

void mountProtectedPage({
  component: SettingsView,
  currentPath: '/settings',
  title: '系统设置'
});
