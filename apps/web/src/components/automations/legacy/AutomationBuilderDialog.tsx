import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AutomationBuilder, type AutomationBuilderInput } from './AutomationBuilder';
import type { CreateAutomationInput, AutomationFilterOptions } from '@tracearr/shared';

interface AutomationBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automation?: AutomationBuilderInput;
  onSave: (data: CreateAutomationInput) => Promise<void>;
  isLoading?: boolean;
  filterOptions?: AutomationFilterOptions;
}

export function AutomationBuilderDialog({
  open,
  onOpenChange,
  automation,
  onSave,
  isLoading,
  filterOptions,
}: AutomationBuilderDialogProps) {
  const { t } = useTranslation('pages');
  const isEditing = !!automation;

  const handleSave = async (data: CreateAutomationInput) => {
    await onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* min() keeps the wide form from outgrowing a narrow window */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(56rem,calc(100%-2rem))]">
        <DialogHeader className="sm:text-center">
          <DialogTitle className="text-xl">
            {isEditing ? t('automations.editAutomation') : t('automations.createAutomation')}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('automations.updateDescription') : t('automations.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <AutomationBuilder
          initialAutomation={automation}
          onSave={handleSave}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
          filterOptions={filterOptions}
        />
      </DialogContent>
    </Dialog>
  );
}

export default AutomationBuilderDialog;
