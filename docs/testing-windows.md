# Testing Nokta on a real Windows PC

CI installs and starts Nokta on a real Windows on every change (see
[testing.md](testing.md)), but it has no mouse, no speakers, no Bluetooth
and no calendar. Before a release, someone goes through this list on their
own PC. It takes about an hour.

## Before you start

- Windows 10 or 11, 64-bit. A laptop is best: it has a battery, a
  brightness key and often a camera.
- A music app that shows in Windows' own media controls: Spotify, the
  Media Player app, or YouTube in Edge or Chrome.
- If you can: Bluetooth headphones, a second monitor, a Google or Outlook
  calendar with an event in the next hour (one with a Meet, Teams or Zoom
  link is better).
- Note your Windows version (`winver`), display scale (Settings → System →
  Display) and language.

Install Nokta as in the README's [Windows install](../README.md#windows),
SmartScreen's **More info → Run anyway** included. If you have Windows'
banners on, turn them off for one app you test notifications with, as the
README says, so you see Nokta's.

## Checklist

Tick what works. For anything that does not, see
[When something is wrong](#when-something-is-wrong).

### Install and start

- [ ] The setup runs without asking for admin rights and Nokta starts by
      itself; a small dark notch sits at the top centre of the screen.
- [ ] Two seconds later the tour opens; **Next** goes through four steps
      and **Skip** closes it. Enter and Escape work if the keyboard reached
      it (Windows may keep the keyboard on the app you were in; then only
      the mouse works, which is fine).
- [ ] The tray (by the clock, maybe under the `^` arrow) has the Nokta
      icon; its **Settings** opens the settings window and **Quit Nokta**
      closes it. Start Nokta from the Start menu again: it comes back.
      Start it once more while it runs: only the settings window opens.
- [ ] Sign out and in again (or restart): Nokta starts by itself.

### The notch and the mouse

- [ ] Moving the pointer onto the notch opens home; moving away closes it.
- [ ] Clicks right beside the notch reach the window under it (a browser
      tab, the desktop), and the app you work in keeps the keyboard when
      you click the notch.
- [ ] The notch stays above other windows, also after clicking another
      app or opening the Start menu and closing it.
- [ ] Right-clicking the notch opens a menu with Settings, Clear shelf and
      Pause clipboard; clicking elsewhere closes it.
- [ ] Scrolling on the notch changes the volume; a middle click plays or
      pauses the music.

### Keyboard

- [ ] <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> opens the notch with a
      focus ring on the first button; Tab, Shift+Tab and the arrows move
      it, Enter presses it, Escape closes the notch and gives the keyboard
      back to your app.
- [ ] <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> starts a focus session;
      again stops it.

### Music

- [ ] Play a song: the closed notch shows its cover and moving bars, and
      widens for a moment with the title when the song changes.
- [ ] Hover: the player shows the cover, title, artist, a seek bar that
      moves, and play, next and previous that work. Seeking works.
- [ ] Lyrics show for a well-known song and the sung part lights up in
      time; the full-screen lyrics button opens them full screen.
- [ ] With two players open (Spotify and a browser video), the arrows
      under the title switch between them.
- [ ] Settings → Behavior: turn on the bars that follow the music; they
      move with the beat.

### Popups and devices

- [ ] The volume keys (or the volume slider) show the volume in the notch;
      mute shows muted. Windows 11's own popup may show too; that is
      expected.
- [ ] Brightness keys on a laptop show the brightness.
- [ ] Caps Lock and Num Lock show on and off; switching the keyboard
      layout (Win+Space, with two layouts) shows the new one.
- [ ] Plugging the charger in and out shows the battery alert.
- [ ] Bluetooth headphones connecting show their name (no battery).

### Notifications

- [ ] A notification from the app whose banners you turned off (a chat
      app, or a mail) shows in the notch with its icon, two lines and its
      buttons; × closes it; clicking it opens the app.
- [ ] Two from the same app in a row count on the icon.

### Calendar

- [ ] Settings → Plugins → Calendar: add a calendar's secret iCal
      address. The list shows only its host, never the whole address.
- [ ] Home lists the next events in the calendar's color within a minute;
      clicking an event opens the calendar on the web.
- [ ] A few minutes before an event the notch reminds you (a meeting has
      **Join**, which opens the call), and the closed notch counts down.

### Shelf, clipboard, downloads and screenshots

- [ ] Drag a file from Explorer onto the notch: it shows a drop area, and
      the file then sits on the shelf in home.
- [ ] Drag it from the shelf into an Explorer folder or a mail: it is
      copied there and leaves the shelf.
- [ ] Copy some text and a picture (Win+Shift+S): the Clipboard tile
      lists both, search finds the text, clicking an entry copies it again.
- [ ] Download a file in a browser: the notch shows it with Open and Show
      in Explorer, both work.
- [ ] Win+PrtScn: the notch shows the screenshot with its buttons.

### Timers and the System page

- [ ] Home's Timer tile starts a 1 minute countdown; it shows on the
      closed notch and rings when it ends. A stopwatch counts up.
- [ ] Home's System tile shows CPU, memory and the network moving (the
      temperature stays empty on Windows).
- [ ] The Caffeine and Dark Style toggles work: Dark Style switches
      Windows' own app colors.

### Camera, microphone and calls

- [ ] Open the Camera app: a green dot shows by the notch.
- [ ] Join a call or record with Sound Recorder: an orange dot and the
      time the microphone has been on show; home names the app, and its
      mute button mutes the microphone (the notch turns red).

### Settings window

- [ ] Every page opens and a change takes effect at once (try a theme, the
      notch width and the clock format).
- [ ] Appearance → Picture: choosing a picture of your own shows it
      behind the open player, and in the preview.
- [ ] The buttons to open the config file and to reset work.
- [ ] Behavior → **Show the tour again** shows the tour on the notch.
- [ ] Plugins → Added → **Add from Folder…** with the `site-status`
      example: it is added off. Turn it on, set its address to
      `http://127.0.0.1:9/`: a red alert says it is down and `down` shows
      in the closed notch. **Open the plugins folder** opens Explorer
      there. Remove asks first.

### Language

- [ ] With Windows' display language set to Indonesian (Settings → Time &
      language → Language), Nokta's notch and settings window are in
      Indonesian after Nokta starts again. The tray stays in English.

### More than one monitor

- [ ] Each monitor has its own notch at its top centre; a volume change
      shows on the monitor of the app you work in.
- [ ] Unplugging and plugging a monitor, or changing its scale, puts the
      notches back in place.

### Fullscreen

- [ ] A fullscreen video or game hides the notch on its monitor; a
      finished timer still shows over it, a volume change does not.

### The `nokta` command

Open a **new** PowerShell window after installing:

- [ ] `nokta --version` prints the version.
- [ ] `nokta activity set test --title "Test" --progress 40` shows an
      activity at 40 %; `nokta activity end test --message "Done"` ends it
      with a green check.
- [ ] `nokta run -- ping -n 5 127.0.0.1` shows the command while it
      runs, then ✓; `nokta run -- cmd /c exit 3` ends with ✗ and `$LASTEXITCODE` is 3.
- [ ] `nokta timer 2m Tea`, `nokta alarm` a few minutes from now, then
      `nokta timer clear`.
- [ ] `nokta settings` opens the settings window.
- [ ] `nokta plugin install <folder>` with the `hello` example from the
      source (`examples\plugins\hello`), then `nokta plugin enable hello`:
      home shows its row and a click on it opens a page of two links. `nokta
      plugin list` shows it `on ok`; `nokta plugin remove hello` takes it
      away.
- [ ] Quit Nokta from the tray: `nokta activity set x --title x` says it
      cannot reach Nokta.

### Updates

Only when a newer release is out than the one installed (install the
previous release first to try it):

- [ ] Home shows that a new Nokta is available; clicking the text opens
      the release page.
- [ ] **Update** closes the notch; a few seconds later Nokta starts again
      on the new version (`nokta --version`), with no window asking
      anything.

### Uninstall

- [ ] Settings → Apps → Installed apps → Nokta → Uninstall removes it; it
      no longer starts at login, and `nokta` is gone in a new terminal.

## When something is wrong

Send:

- what you did, what you expected and what happened;
- a screenshot (Win+Shift+S) or a short screen recording;
- the log, `%LOCALAPPDATA%\nokta\nokta.log` (paste the path in Explorer's
  address bar). It holds no calendar address, only its host;
- your Windows version, display scale and language.

Not bugs, as Windows offers no way to do them: the differences listed
under the README's [Windows install](../README.md#windows), such as no Do
Not Disturb or Night Light toggles, Windows 11's volume popup beside the
notch's, no CPU temperature and no Bluetooth battery.
