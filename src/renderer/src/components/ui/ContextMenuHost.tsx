import { useContextMenu } from '@/state/contextMenu';
import { Menu } from './Menu';
import { Popover } from './Popover';

/** Renders the single global context menu (opened with `openContextMenu`). */
export function ContextMenuHost() {
  const { menu, close } = useContextMenu();
  if (!menu) return null;
  return (
    <Popover open onClose={close} anchor={{ x: menu.x, y: menu.y }} placement="bottom-start">
      <Menu items={menu.items} onClose={close} />
    </Popover>
  );
}
