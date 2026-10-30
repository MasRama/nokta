import Gio from 'gi://Gio';

import { FilePreview, type PreviewButton, type PreviewPicture } from '../../shared/file-preview.js';
import { iconFor } from '../../shared/icons.js';
import { N_ } from '../../shared/logic/i18n.js';
import type { Download, DownloadButton } from './logic/download.js';

const BUTTONS: readonly PreviewButton<DownloadButton>[] = [
    { id: 'open', icon: 'document-open-symbolic', label: N_('Open') },
    { id: 'files', icon: 'folder-open-symbolic', label: N_('Show in Files') },
    { id: 'keep', icon: 'folder-documents-symbolic', label: N_('Keep on shelf') },
];

/** A finished download in the notch, with a button for each thing it can do; a click on the picture opens it. */
export const downloadPreview = (onPress: (button: DownloadButton) => void): FilePreview<DownloadButton> =>
    new FilePreview('nokta-download', BUTTONS, 'open', onPress);

/** noktad's thumbnail of a picture, else the icon for the file's kind. */
export const downloadPicture = ({ thumbnail, icon }: Download): PreviewPicture =>
    thumbnail
        ? { kind: 'file', uri: Gio.File.new_for_path(thumbnail).get_uri() }
        : { kind: 'icon', icon: iconFor(icon || 'text-x-generic') };
