import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { Cover } from './cover.js';
import type { MediaSnapshot } from './logic/snapshot.js';
import { ProgressBar } from './progress.js';

export interface MediaControls {
    playPause(): void;
    next(): void;
    previous(): void;
    setPosition(us: number): void;
}

function ellipsized(styleClass: string): St.Label {
    const label = new St.Label({ style_class: styleClass, x_expand: true });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

/**
 * The open notch: cover, title, artists, an optional lyric row, progress
 * with times, and previous / play-pause / next.
 */
export class ExpandedMediaView {
    readonly actor: St.BoxLayout;
    readonly progress: ProgressBar;
    private readonly cover = new Cover(64, 10);
    private readonly title = ellipsized('nokta-title');
    private readonly artists = ellipsized('nokta-artists');
    private readonly info: St.BoxLayout;
    private readonly previous: St.Button;
    private readonly playPause: St.Button;
    private readonly next: St.Button;
    private readonly playPauseIcon: St.Icon;

    constructor(controls: MediaControls) {
        this.actor = new St.BoxLayout({ style_class: 'nokta-expanded', vertical: true, y_align: Clutter.ActorAlign.START });

        const top = new St.BoxLayout({ style_class: 'nokta-expanded-top' });
        this.info = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this.info.add_child(this.title);
        this.info.add_child(this.artists);
        top.add_child(this.cover.actor);
        top.add_child(this.info);

        this.progress = new ProgressBar((us) => controls.setPosition(us));

        const buttons = new St.BoxLayout({ style_class: 'nokta-controls', x_align: Clutter.ActorAlign.CENTER });
        this.previous = this.button('media-skip-backward-symbolic', () => controls.previous());
        this.playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', style_class: 'nokta-play-icon' });
        this.playPause = new St.Button({ style_class: 'nokta-button nokta-play', child: this.playPauseIcon, can_focus: true });
        this.playPause.connect('clicked', () => controls.playPause());
        this.next = this.button('media-skip-forward-symbolic', () => controls.next());
        buttons.add_child(this.previous);
        buttons.add_child(this.playPause);
        buttons.add_child(this.next);

        this.actor.add_child(top);
        this.actor.add_child(this.progress.actor);
        this.actor.add_child(buttons);
    }

    /** Where the lyric line goes: under the artists. */
    get infoBox(): St.BoxLayout {
        return this.info;
    }

    update(snapshot: MediaSnapshot): void {
        this.cover.set(snapshot.artPath);
        this.title.text = snapshot.title || snapshot.playerName;
        this.artists.text = snapshot.artists.join(', ');
        this.artists.visible = snapshot.artists.length > 0;
        this.playPauseIcon.icon_name =
            snapshot.playbackStatus === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this.enable(this.previous, snapshot.canGoPrevious);
        this.enable(this.playPause, snapshot.canPlayPause);
        this.enable(this.next, snapshot.canGoNext);
    }

    destroy(): void {
        this.progress.destroy();
        this.actor.destroy();
    }

    private button(icon: string, onClick: () => void): St.Button {
        const button = new St.Button({
            style_class: 'nokta-button',
            child: new St.Icon({ icon_name: icon, style_class: 'nokta-button-icon' }),
            can_focus: true,
        });
        button.connect('clicked', onClick);
        return button;
    }

    private enable(button: St.Button, enabled: boolean): void {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }
}
