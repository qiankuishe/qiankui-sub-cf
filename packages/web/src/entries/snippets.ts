import { mountProtectedPage } from '../bootstrap/mountPage';
import SnippetsView from '../views/snippets/SnippetsView.vue';

void mountProtectedPage({
  component: SnippetsView,
  currentPath: '/snippets',
  title: '剪贴板'
});
