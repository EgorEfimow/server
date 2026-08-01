import * as React from 'react';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import TextField from '@material-ui/core/TextField';

const storageKey = (dashboardId: number) => `traggo-external-url-${dashboardId}`;

// The external URL is stored per-browser in localStorage (frontend-only feature);
// it does not sync across devices for the same Traggo user. Accepted limitation.
export const getExternalUrl = (dashboardId: number): string => {
    try {
        return localStorage.getItem(storageKey(dashboardId)) || '';
    } catch {
        return '';
    }
};

export const setExternalUrl = (dashboardId: number, url: string): void => {
    const trimmed = url.trim();
    try {
        if (trimmed) {
            localStorage.setItem(storageKey(dashboardId), trimmed);
        } else {
            localStorage.removeItem(storageKey(dashboardId));
        }
    } catch {
        // storage unavailable; the dashboard falls back to the built-in view
    }
};

export const kioskUrl = (url: string): string => url;

export const ExternalUrlDialog: React.FC<{
    open: boolean;
    url: string;
    onSave: (url: string) => void;
    onClose: () => void;
}> = ({open, url, onSave, onClose}) => {
    const [value, setValue] = React.useState(url);
    React.useEffect(() => setValue(url), [open, url]);
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>External dashboard URL</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    fullWidth
                    label="Dashboard URL"
                    placeholder="http://localhost:3000/d/traggo-study-overview/traggo-overview"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    helperText="Leave empty to use the built-in Traggo dashboard"
                />
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={() => {
                        onSave('');
                        onClose();
                    }}>
                    Clear
                </Button>
                <Button
                    color={'primary'}
                    onClick={() => {
                        onSave(value);
                        onClose();
                    }}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};
