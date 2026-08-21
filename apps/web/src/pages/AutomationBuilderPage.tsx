import { useParams } from 'react-router';
import { AutomationBuilder } from '@/components/automations/builder';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutomation } from '@/hooks/queries/useAutomations';

export function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: automation, isLoading } = useAutomation(id);

  if (isLoading) {
    return <Skeleton className="mx-auto h-96 w-full max-w-4xl" />;
  }

  return <AutomationBuilder automation={automation} />;
}
