"use client";

import { useState, useCallback } from "react";
import {
  ServerActionResult,
  ServerActionResultWithValidation,
} from "@/lib/server-action-result";
import { describeThrownError } from "@/lib/thrown-error";
import { useToast } from "@/hooks/use-toast";

type ServerActionFunction<TParams, TResult> = (
  params: TParams,
) => Promise<
  ServerActionResult<TResult> | ServerActionResultWithValidation<TResult>
>;

interface UseServerActionOptions<TResult = void> {
  onSuccess?: (data: TResult) => void;
  onError?: (error: string, code?: string) => void;
  showToast?: boolean;
  successMessage?: string;
}

export function useServerAction<TParams = void, TResult = void>(
  action: ServerActionFunction<TParams, TResult>,
  options: UseServerActionOptions<TResult> = {},
) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<
    string,
    string[]
  > | null>(null);
  const { toast } = useToast();

  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Operation completed successfully",
  } = options;

  const execute = useCallback(
    async (params: TParams) => {
      setIsLoading(true);
      setError(null);
      setValidationErrors(null);

      try {
        const result = await action(params);

        if (result.success) {
          if (showToast) {
            toast({
              title: "Success",
              description: successMessage,
            });
          }

          if (onSuccess) {
            onSuccess(result.data);
          }

          return result;
        } else {
          setError(result.error);

          if ("validationErrors" in result && result.validationErrors) {
            setValidationErrors(result.validationErrors);
          }

          if (showToast) {
            toast({
              title: "Error",
              description: result.error,
              variant: "destructive",
            });
          }

          if (onError) {
            onError(result.error, result.code);
          }

          return result;
        }
      } catch (err) {
        // This should rarely happen as server actions should return results
        const errorMessage =
          describeThrownError(err, "An unexpected error occurred");
        setError(errorMessage);

        if (showToast) {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }

        if (onError) {
          onError(errorMessage);
        }

        return {
          success: false,
          error: errorMessage,
        } as ServerActionResult<TResult>;
      } finally {
        setIsLoading(false);
      }
    },
    [action, onSuccess, onError, showToast, successMessage, toast],
  );

  return {
    execute,
    isLoading,
    error,
    validationErrors,
  };
}

// Helper hook for server actions that don't need parameters
export function useServerActionNoParams<TResult = void>(
  action: () => Promise<
    ServerActionResult<TResult> | ServerActionResultWithValidation<TResult>
  >,
  options: UseServerActionOptions<TResult> = {},
) {
  const serverAction = useServerAction<void, TResult>(() => action(), options);

  const execute = useCallback(() => {
    return serverAction.execute(undefined);
  }, [serverAction]);

  return {
    ...serverAction,
    execute,
  };
}
