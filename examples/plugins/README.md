# Example plugins

Plugins to copy when you write your own; [docs/plugins.md](../../docs/plugins.md)
explains the contract.

| Plugin | Shows |
| --- | --- |
| [`hello`](hello) | A greeting with a list of links, and two options |
| [`site-status`](site-status) | Whether a site answers: a badge and an alert while it is down |
| [`water`](water) | Glasses of water today with `+1` and `Undo`; it keeps running and hears its buttons |

Try one: `nokta plugin install examples/plugins/hello`, then
`nokta plugin enable hello`.
