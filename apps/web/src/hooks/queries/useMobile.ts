import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MobileConfig } from '@tracearr/shared';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useMobileConfig() {
  return useQuery({
    queryKey: ['mobile', 'config'],
    queryFn: api.mobile.get,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useEnableMobile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: api.mobile.enable,
    onSuccess: (data) => {
      queryClient.setQueryData<MobileConfig>(['mobile', 'config'], data);
      toast({
        title: 'Mobile Access Enabled',
        description: 'Scan the QR code with the Tracearr mobile app to connect.',
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to Enable Mobile Access',
        description: (err as Error).message,
        variant: 'destructive',
      });
    },
  });
}

export function useDisableMobile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: api.mobile.disable,
    onSuccess: () => {
      queryClient.setQueryData<MobileConfig>(['mobile', 'config'], (old) => {
        if (!old) return old;
        return { ...old, isEnabled: false, token: null, sessions: [] };
      });
      toast({
        title: 'Mobile Access Disabled',
        description: 'All mobile sessions have been revoked.',
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to Disable Mobile Access',
        description: (err as Error).message,
        variant: 'destructive',
      });
    },
  });
}

export function useRotateMobileToken() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: api.mobile.rotate,
    onSuccess: (data) => {
      queryClient.setQueryData<MobileConfig>(['mobile', 'config'], data);
      toast({
        title: 'Token Rotated',
        description: 'All previous mobile sessions have been revoked. Scan the new QR code to reconnect.',
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to Rotate Token',
        description: (err as Error).message,
        variant: 'destructive',
      });
    },
  });
}

export function useRevokeMobileSessions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: api.mobile.revokeSessions,
    onSuccess: (data) => {
      queryClient.setQueryData<MobileConfig>(['mobile', 'config'], (old) => {
        if (!old) return old;
        return { ...old, sessions: [] };
      });
      toast({
        title: 'Sessions Revoked',
        description: `${data.revokedCount} mobile session(s) have been revoked.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to Revoke Sessions',
        description: (err as Error).message,
        variant: 'destructive',
      });
    },
  });
}
