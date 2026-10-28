/** The settings window's own class; every rule below starts with it. */
export const PREFS_CLASS = 'nokta-prefs';

/** Nokta's accent in the settings window. */
export const EMBER = '#ff6a3d';

// Themes such as Ubuntu's paint the accent as a background image over the
// color, so each rule that sets an accent clears the image too.
// Literal colors only: GTK 4.14 (GNOME 46) has no CSS variables, and Adwaita's
// named colors follow the system style, while the window stays dark.
const TEXT = '#f5f5f7';
const ON_EMBER = '#1a0b06';
const WINDOW = '#0b0b0d';
const SIDEBAR = '#121215';
const CARD = '#18181c';
const RAISED = '#1f1f24';
const LINE = 'rgba(255, 255, 255, 0.07)';

/**
 * The settings window's stylesheet: dark surfaces whatever the system style,
 * ember for what is on or chosen. It is added for the whole display, so each
 * rule is scoped to the window's class and other extensions' windows in the
 * same process keep their look.
 */
export const PREFS_CSS = `
.${PREFS_CLASS} {
    background-color: ${WINDOW};
    color: ${TEXT};
}

.${PREFS_CLASS} headerbar {
    background-color: transparent;
    color: ${TEXT};
    box-shadow: none;
}

.${PREFS_CLASS} .sidebar-pane {
    background-color: ${SIDEBAR};
    color: ${TEXT};
    border-right: 1px solid ${LINE};
}

.${PREFS_CLASS} .nokta-brand {
    font-size: 20px;
    font-weight: 800;
}

.${PREFS_CLASS} .nokta-brand-dot {
    min-width: 8px;
    min-height: 8px;
    border-radius: 4px;
    background-color: ${EMBER};
}

.${PREFS_CLASS} .navigation-sidebar {
    background-color: transparent;
}

.${PREFS_CLASS} .navigation-sidebar > row {
    margin: 2px 8px;
    padding: 9px 10px;
    border-radius: 10px;
    font-weight: 600;
}

.${PREFS_CLASS} .navigation-sidebar > row:hover {
    background-color: rgba(255, 255, 255, 0.05);
}

.${PREFS_CLASS} .navigation-sidebar > row:selected {
    background-image: none;
    background-color: rgba(255, 106, 61, 0.16);
}

.${PREFS_CLASS} .navigation-sidebar > row:selected image {
    color: ${EMBER};
}

.${PREFS_CLASS} preferencesgroup .heading {
    color: rgba(245, 245, 247, 0.6);
}

.${PREFS_CLASS} list.boxed-list {
    background-color: ${CARD};
    color: ${TEXT};
    border-radius: 14px;
    box-shadow: 0 0 0 1px ${LINE};
}

.${PREFS_CLASS} list.boxed-list > row {
    border-color: ${LINE};
}

.${PREFS_CLASS} list.boxed-list > row.activatable:hover {
    background-color: rgba(255, 255, 255, 0.04);
}

.${PREFS_CLASS} switch {
    background-color: rgba(255, 255, 255, 0.16);
}

.${PREFS_CLASS} switch:checked {
    background-image: none;
    background-color: ${EMBER};
}

.${PREFS_CLASS} switch > slider,
.${PREFS_CLASS} scale > trough > slider {
    background-color: #ffffff;
}

.${PREFS_CLASS} scale > trough {
    background-color: rgba(255, 255, 255, 0.14);
}

.${PREFS_CLASS} scale > trough > highlight {
    background-image: none;
    background-color: ${EMBER};
}

.${PREFS_CLASS} checkbutton > check:checked,
.${PREFS_CLASS} checkbutton > radio:checked,
.${PREFS_CLASS} button.suggested-action {
    background-image: none;
    background-color: ${EMBER};
    color: ${ON_EMBER};
}

.${PREFS_CLASS} spinbutton,
.${PREFS_CLASS} spinbutton > text,
.${PREFS_CLASS} spinbutton > button {
    color: ${TEXT};
}

.${PREFS_CLASS} popover > contents,
.${PREFS_CLASS} popover > arrow,
.${PREFS_CLASS} toast {
    background-color: ${RAISED};
    color: ${TEXT};
}

.${PREFS_CLASS} banner > revealer > widget {
    background-color: rgba(255, 106, 61, 0.14);
    color: ${TEXT};
}

.${PREFS_CLASS} selection {
    background-color: rgba(255, 106, 61, 0.35);
}

.${PREFS_CLASS} *:focus-visible {
    outline-color: rgba(255, 106, 61, 0.6);
}

/* The live preview and the theme gallery at the top of Appearance. */
.${PREFS_CLASS} .nokta-preview {
    border-radius: 16px;
    box-shadow: 0 0 0 1px ${LINE};
}

.${PREFS_CLASS} .nokta-theme-card {
    padding: 8px 6px 6px;
    border-radius: 14px;
    background-color: transparent;
    box-shadow: inset 0 0 0 2px transparent;
}

.${PREFS_CLASS} .nokta-theme-card:hover {
    background-color: rgba(255, 255, 255, 0.05);
}

.${PREFS_CLASS} .nokta-theme-card.chosen {
    box-shadow: inset 0 0 0 2px ${EMBER};
}

.${PREFS_CLASS} .nokta-theme-label {
    font-size: 12px;
    font-weight: 600;
}
`;
