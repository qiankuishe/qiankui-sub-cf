import { mountProtectedPage } from '../bootstrap/mountPage';
import NavigationView from '../views/navigation/NavigationView.vue';

void mountProtectedPage({
  component: NavigationView,
  currentPath: '/nav',
  title: '网站导航'
});
