import {
  AppWindow,
  CalendarDays,
  Code2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  Globe,
  Mail,
  MessageSquare,
  Presentation,
  Video,
  type LucideProps,
} from 'lucide-react';
import type { ActivityKind } from '@core/model';

const ICONS: Record<ActivityKind, (props: LucideProps) => React.ReactNode> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: FileType2,
  email: Mail,
  calendar: CalendarDays,
  meeting: Video,
  chat: MessageSquare,
  browser: Globe,
  files: Folder,
  development: Code2,
  other: AppWindow,
};

export function KindIcon({ kind, ...props }: { kind: ActivityKind } & LucideProps) {
  const Icon = ICONS[kind] ?? AppWindow;
  return <Icon {...props} />;
}
