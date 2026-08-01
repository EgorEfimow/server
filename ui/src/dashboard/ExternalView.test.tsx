import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {act} from 'react-dom/test-utils';
import {ExternalUrlDialog, getExternalUrl, kioskUrl, setExternalUrl} from './ExternalView';

describe('external url storage', () => {
    beforeEach(() => localStorage.clear());

    it('stores and reads the url per dashboard, trimmed', () => {
        setExternalUrl(1, '  http://example.com/dash  ');
        expect(getExternalUrl(1)).toBe('http://example.com/dash');
        expect(getExternalUrl(2)).toBe('');
    });

    it('clears the stored url when input is empty', () => {
        setExternalUrl(1, 'http://example.com');
        setExternalUrl(1, '   ');
        expect(getExternalUrl(1)).toBe('');
    });

    it('kioskUrl is the identity', () => {
        expect(kioskUrl('http://example.com')).toBe('http://example.com');
    });
});

describe('ExternalUrlDialog', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders title, helper text and buttons', () => {
        act(() => {
            ReactDOM.render(
                <ExternalUrlDialog open={true} url={''} onSave={jest.fn()} onClose={jest.fn()} />,
                document.createElement('div')
            );
        });
        expect(document.body.textContent).toContain('External dashboard URL');
        expect(document.body.textContent).toContain('Leave empty to use the built-in Traggo dashboard');
        expect(document.body.textContent).toContain('Save');
    });

    it('calls onSave with the empty string on Clear', () => {
        const onSave = jest.fn();
        act(() => {
            ReactDOM.render(
                <ExternalUrlDialog open={true} url={'http://example.com'} onSave={onSave} onClose={jest.fn()} />,
                document.createElement('div')
            );
        });
        const buttons = Array.from(document.querySelectorAll('button'));
        const clear = buttons.find((b) => b.textContent === 'Clear');
        expect(clear).toBeDefined();
        act(() => {
            clear!.click();
        });
        expect(onSave).toHaveBeenCalledWith('');
    });
});
