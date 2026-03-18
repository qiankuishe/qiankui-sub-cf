import type { AppSectionItem } from '../../utils/pageConfig';
import { APP_SECTION_ITEMS } from '../../utils/pageConfig';

export type AppNavItem = Pick<AppSectionItem, 'label' | 'to'>;

export const APP_NAV_ITEMS: AppNavItem[] = APP_SECTION_ITEMS.map(({ label, to }) => ({ label, to }));
