import type Clutter from 'gi://Clutter';

import { FilePreview, type PreviewButton, type PreviewPicture } from '../../shared/file-preview.js';
import { iconFor } from '../../shared/icons.js';
import { N_ } from '../../shared/logic/i18n.js';
import type { ScreenshotButton } from './logic/screenshot.js';

const BUTTONS: readonly PreviewButton<ScreenshotButton>[] = [
    { id: 'open', icon: 'document-open-symbolic', label: N_('Open') },
    { id: 'files', icon: 'folder-open-symbolic', label: N_('Show in Files') },
    { id: 'keep', icon: 'folder-documents-symbolic', label: N_('Keep on shelf') },
];

/** A new screenshot in the notch, with a button for each thing it can do; a click on the image opens it. */
export const screenshotPreview = (onPress: (button: ScreenshotButton) => void): FilePreview<ScreenshotButton> =>
    new FilePreview('nokta-screenshot', BUTTONS, 'open', onPress);

/** GNOME's own picture of the screenshot, from its notification; a screen recording has none and shows a video icon. */
export const screenshotPicture = (image: Clutter.Content | null): PreviewPicture =>
    image ? { kind: 'content', content: image } : { kind: 'icon', icon: iconFor('video-x-generic-symbolic') };
