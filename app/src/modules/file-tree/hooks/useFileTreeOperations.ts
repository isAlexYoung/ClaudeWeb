import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import JSZip from 'jszip';

import { api } from '@/shared/api';
import type { FileTreeNode,Project } from '@/shared/types';
import { copyTextToClipboard, pickFileDownload } from '@/shared/utils';

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type ToastMessage = {
  message: string;
  type: 'success' | 'error';
};

export type DeleteConfirmation = {
  isOpen: boolean;
  item: FileTreeNode | null;
};

export type UseFileTreeOperationsOptions = {
  selectedProject: Project | null;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
};

export type UseFileTreeOperationsResult = {
  // Rename operations
  renamingItem: FileTreeNode | null;
  renameValue: string;
  handleStartRename: (item: FileTreeNode) => void;
  handleCancelRename: () => void;
  handleConfirmRename: () => Promise<void>;
  setRenameValue: (value: string) => void;

  // Delete operations
  deleteConfirmation: DeleteConfirmation;
  handleStartDelete: (item: FileTreeNode) => void;
  handleCancelDelete: () => void;
  handleConfirmDelete: () => Promise<void>;

  // Create operations
  isCreating: boolean;
  newItemParent: string;
  newItemType: 'file' | 'directory';
  newItemName: string;
  handleStartCreate: (parentPath: string, type: 'file' | 'directory') => void;
  handleCancelCreate: () => void;
  handleConfirmCreate: () => Promise<void>;
  setNewItemName: (name: string) => void;

  // Other operations
  handleCopyPath: (item: FileTreeNode) => void;
  handleDownload: (item: FileTreeNode) => Promise<void>;

  // Loading state
  operationLoading: boolean;

  // Validation
};

export function useFileTreeOperations({
  selectedProject,
  onRefresh,
  showToast,
}: UseFileTreeOperationsOptions): UseFileTreeOperationsResult {
  const { t } = useTranslation();

  // State
  const [renamingItem, setRenamingItem] = useState<FileTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>({
    isOpen: false,
    item: null,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);
  // The draft identity and synchronous lock reject Enter+blur duplicates, including callbacks from a closed draft.
  const creationRef = useRef<{ pending: boolean } | null>(null);
  const creation = creationRef.current;

  // Validation
  const validateFilename = useCallback((name: string): string | null => {
    if (!name || !name.trim()) {
      return t('fileTree.validation.emptyName', 'Filename cannot be empty');
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return t('fileTree.validation.invalidChars', 'Filename contains invalid characters');
    }
    if (RESERVED_NAMES.test(name)) {
      return t('fileTree.validation.reserved', 'Filename is a reserved name');
    }
    if (/^\.+$/.test(name)) {
      return t('fileTree.validation.dotsOnly', 'Filename cannot be only dots');
    }
    return null;
  }, [t]);

  // Rename operations
  const handleStartRename = useCallback((item: FileTreeNode) => {
    setRenamingItem(item);
    setRenameValue(item.name);
    setIsCreating(false);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingItem(null);
    setRenameValue('');
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingItem || !selectedProject) return;

    const error = validateFilename(renameValue);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (renameValue === renamingItem.name) {
      handleCancelRename();
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.renameFile(selectedProject.projectId, {
        oldPath: renamingItem.path,
        newName: renameValue,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename');
      }

      showToast(t('fileTree.toast.renamed', 'Renamed successfully'), 'success');
      onRefresh();
      handleCancelRename();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [renamingItem, renameValue, selectedProject, validateFilename, showToast, t, onRefresh, handleCancelRename]);

  // Delete operations
  const handleStartDelete = useCallback((item: FileTreeNode) => {
    setDeleteConfirmation({ isOpen: true, item });
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmation({ isOpen: false, item: null });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { item } = deleteConfirmation;
    if (!item || !selectedProject) return;

    setOperationLoading(true);
    try {
      const response = await api.deleteFile(selectedProject.projectId, {
        path: item.path,
        type: item.type,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      showToast(
        item.type === 'directory'
          ? t('fileTree.toast.folderDeleted', 'Folder deleted')
          : t('fileTree.toast.fileDeleted', 'File deleted'),
        'success'
      );
      onRefresh();
      handleCancelDelete();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [deleteConfirmation, selectedProject, showToast, t, onRefresh, handleCancelDelete]);

  // Create operations
  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'directory') => {
    creationRef.current = { pending: false };
    setNewItemParent(parentPath || '');
    setNewItemType(type);
    setNewItemName(type === 'file' ? 'untitled.txt' : 'new-folder');
    setIsCreating(true);
    setRenamingItem(null);
  }, []);

  const handleCancelCreate = useCallback(() => {
    creationRef.current = null;
    setIsCreating(false);
    setNewItemParent('');
    setNewItemName('');
  }, []);

  const handleConfirmCreate = useCallback(async () => {
    if (!selectedProject || !creation || creationRef.current !== creation || creation.pending) return;

    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    creation.pending = true;
    setOperationLoading(true);
    try {
      const response = await api.createFile(selectedProject.projectId, {
        path: newItemParent,
        type: newItemType,
        name: newItemName,
      });

      if (!response.ok) {
        const data = await response.json();
        const exists = data.code === 'FILE_TREE_ENTRY_EXISTS' || data.code === 'EEXIST' || /already exists/i.test(data.error || '');
        throw new Error(exists ? t('fileTree.errors.alreadyExists') : t('fileTree.errors.createFailed'));
      }

      showToast(
        newItemType === 'file'
          ? t('fileTree.toast.fileCreated', 'File created successfully')
          : t('fileTree.toast.folderCreated', 'Folder created successfully'),
        'success'
      );
      onRefresh();
      if (creationRef.current === creation) handleCancelCreate();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      creation.pending = false;
      setOperationLoading(false);
    }
  }, [selectedProject, creation, newItemParent, newItemType, newItemName, validateFilename, showToast, t, onRefresh, handleCancelCreate]);

  // Copy path to clipboard. The shared helper falls back to `execCommand('copy')` when the
  // Clipboard API is missing (plain-HTTP access) or rejects the write (some mobile browsers);
  // a single toast reports its outcome once it is known.
  const handleCopyPath = useCallback((item: FileTreeNode) => {
    void copyTextToClipboard(item.path).then((didCopy) => {
      if (didCopy) {
        showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
      } else {
        showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
      }
    });
  }, [showToast, t]);

  // Download a single file
  const downloadSingleFile = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    // Use the binary streaming endpoint so downloads preserve raw bytes.
    const response = await api.readFileBlob(selectedProject.projectId, item.path);

    if (!response.ok) {
      throw new Error(t('fileTree.errors.downloadFailed'));
    }

    return response.blob();
  }, [selectedProject, t]);

  // Download folder as ZIP
  const downloadFolderAsZip = useCallback(async (folder: FileTreeNode) => {
    if (!selectedProject) return;

    const zip = new JSZip();

    // Recursively get all files in the folder
    const collectFiles = async (node: FileTreeNode, currentPath: string, isRoot = false) => {
      const fullPath = isRoot ? '' : currentPath ? `${currentPath}/${node.name}` : node.name;

      if (node.type === 'file') {
        const response = await api.readFileBlob(selectedProject.projectId, node.path);
        if (!response.ok) {
          throw new Error(t('fileTree.errors.downloadFailed'));
        }

        // Store raw bytes in the archive so binary files stay intact.
        const fileBytes = await response.arrayBuffer();
        zip.file(fullPath, fileBytes);
      } else if (node.type === 'directory') {
        let children = node.children;
        if (!children?.length) {
          const response = await api.browseProjectFiles(selectedProject.projectId, node.path);
          if (!response.ok) throw new Error(t('fileTree.errors.downloadFailed'));
          children = (await response.json()).files as FileTreeNode[];
        }
        if (children.length === 0 && fullPath) zip.folder(fullPath);
        for (const child of children) {
          await collectFiles(child, fullPath);
        }
      }
    };

    // Parent-directory listings are shallow; load unexpanded folders before archiving them.
    await collectFiles(folder, '', true);
    return zip.generateAsync({ type: 'blob' });
  }, [selectedProject, t]);

  // Download file or folder. Declared after the two helpers it dispatches to so
  // it does not read them before initialization; both are memoized on
  // `selectedProject` plus stable values, so the dependency list is unchanged
  // in practice.
  const handleDownload = useCallback(async (item: FileTreeNode) => {
    if (!selectedProject) return;

    setOperationLoading(true);
    try {
      // Open the picker in the click's activation window, before network or ZIP work.
      const destination = await pickFileDownload(item.type === 'directory' ? `${item.name}.zip` : item.name);
      if (!destination) return;
      const blob = item.type === 'directory' ? await downloadFolderAsZip(item) : await downloadSingleFile(item);
      if (!blob) return;
      await destination.save(blob);
      showToast(t(destination.browserDefault ? 'fileTree.toast.browserDownloadSettings' : 'fileTree.toast.fileDownloaded'), 'success');
    } catch (err) {
      showToast(t('fileTree.errors.downloadFailed'), 'error');
    } finally {
      setOperationLoading(false);
    }
  }, [downloadFolderAsZip, downloadSingleFile, selectedProject, showToast, t]);

  return {
    // Rename operations
    renamingItem,
    renameValue,
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
    setRenameValue,

    // Delete operations
    deleteConfirmation,
    handleStartDelete,
    handleCancelDelete,
    handleConfirmDelete,

    // Create operations
    isCreating,
    newItemParent,
    newItemType,
    newItemName,
    handleStartCreate,
    handleCancelCreate,
    handleConfirmCreate,
    setNewItemName,

    // Other operations
    handleCopyPath,
    handleDownload,

    // Loading state
    operationLoading,

    // Validation
  };
}
