import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTemplates } from '@/hooks/queries/useTemplates';
import { templateDescription, templateName } from '@/lib/automations';
import { cn } from '@/lib/utils';
import { TemplateBindingForm } from './TemplateBindingForm';
import { TemplateGallery } from './TemplateGallery';

/** The import views are the paste step and its review; the review arrives with import. */
type View = 'gallery' | 'bind' | 'paste';

/** Full screen below sm, and still a Dialog: one tree, one focus story. */
const MOBILE_FULLSCREEN =
  'max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0';

interface NewAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A deep link opens straight into this template's binding form. */
  templateId?: string | null;
  initialView?: 'gallery' | 'paste';
}

/** One button, one dialog: pick a ready-made automation, then fill in what is yours. */
export function NewAutomationDialog({
  open,
  onOpenChange,
  templateId,
  initialView = 'gallery',
}: NewAutomationDialogProps) {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const [intent, setIntent] = useState<View>(templateId ? 'bind' : initialView);
  const [picked, setPicked] = useState<string | null>(templateId ?? null);

  const { data: templates, isLoading, isError, refetch } = useTemplates();
  const selected =
    picked === null ? undefined : templates?.find((template) => template.id === picked);
  // A deep link that names nothing this server has falls back rather than hanging on a blank form.
  const missing = intent === 'bind' && picked !== null && templates !== undefined && !selected;
  // The gallery covers the wait, so the binding form only ever renders a template it has.
  const view: View = intent === 'bind' && !selected ? 'gallery' : intent;

  const backToGallery = () => {
    setIntent('gallery');
    setPicked(null);
  };

  useEffect(() => {
    if (!missing) return;
    toast.error(t('automations.gallery.missing'));
    setIntent('gallery');
    setPicked(null);
  }, [missing, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          'flex h-[min(72vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl',
          MOBILE_FULLSCREEN
        )}
        onEscapeKeyDown={(event) => {
          // A stray Esc must not throw away a half-filled form; it goes back first.
          if (view === 'gallery') return;
          event.preventDefault();
          backToGallery();
        }}
        onKeyDown={(event) => {
          if (event.key !== '/' || view !== 'gallery') return;
          if (event.target === searchRef.current) return;
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <DialogHeader className="gap-1 px-6 pt-5 pr-12 pb-3 text-left">
          {view === 'gallery' ? (
            <>
              <DialogTitle>{t('automations.gallery.title')}</DialogTitle>
              <DialogDescription>{t('automations.gallery.description')}</DialogDescription>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-ml-2 size-7"
                  aria-label={t('automations.bind.back')}
                  onClick={backToGallery}
                >
                  <ChevronLeft />
                </Button>
                <DialogTitle>
                  {view === 'paste'
                    ? t('automations.gallery.paste.title')
                    : selected && templateName(t, selected)}
                </DialogTitle>
                {selected?.builtin && (
                  <Badge variant="secondary">
                    <ShieldCheck className="size-3" />
                    {t('automations.gallery.builtin')}
                  </Badge>
                )}
              </div>
              <DialogDescription className="sr-only">
                {view === 'paste'
                  ? t('automations.gallery.paste.description')
                  : selected && templateDescription(t, selected)}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {view === 'gallery' && (
          <TemplateGallery
            templates={templates ?? []}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            searchRef={searchRef}
            onPick={(id) => {
              setPicked(id);
              setIntent('bind');
            }}
            onPaste={() => {
              setPicked(null);
              setIntent('paste');
            }}
            onScratch={() => void navigate('/automations/new')}
          />
        )}

        {view === 'bind' && selected && (
          <TemplateBindingForm
            template={selected}
            onBack={backToGallery}
            onDone={() => onOpenChange(false)}
          />
        )}

        {view === 'paste' && (
          <div className="flex flex-1 flex-col">
            <p className="text-muted-foreground flex-1 px-6 py-4 text-sm">
              {t('automations.gallery.paste.pending')}
            </p>
            <div className="flex justify-end border-t px-6 py-4">
              <Button type="button" variant="outline" onClick={backToGallery}>
                {t('automations.bind.back')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
