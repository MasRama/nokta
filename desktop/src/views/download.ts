import type { Download, DownloadButton } from '@ext/features/downloads/logic/download.js';
import { N_ } from '@ext/shared/logic/i18n.js';

import { FilePreview, type PreviewButton, type PreviewPicture } from './file-preview.js';

const BUTTONS: readonly PreviewButton<DownloadButton>[] = [
    { id: 'open', icon: 'document-open', label: N_('Open') },
    { id: 'files', icon: 'folder-open', label: N_('Show in Explorer') },
    { id: 'keep', icon: 'folder', label: N_('Keep on shelf') },
];

/** A finished download in the notch, with a button for each thing it can do; a click on the picture opens it. */
export const downloadPreview = (onPress: (button: DownloadButton) => void): FilePreview<DownloadButton> =>
    new FilePreview('nokta-download', BUTTONS, 'open', onPress);

/** The core's thumbnail of a picture, as `url` makes it loadable, else the icon for the file's kind. */
export const downloadPicture = ({ thumbnail, icon }: Download, url: (path: string) => string): PreviewPicture =>
    thumbnail ? { kind: 'file', url: url(thumbnail) } : { kind: 'icon', icon: icon || 'text-x-generic' };
