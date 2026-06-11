import * as path from 'path';
import { BrowserWindow, shell } from 'electron';
import serve from 'electron-serve';
import { logger as log } from './log';
import { isDevelopment } from './util';

// Set up electron-serve
let loadURL: (window: BrowserWindow) => void;

if (isDevelopment) {
	const expoPort = process.env.EXPO_PORT || '8088';
	loadURL = (window: BrowserWindow) => window.loadURL(`http://localhost:${expoPort}`);
} else {
	// In production mode, serve the 'dist' directory from resources
	const pathToDist = path.join(process.resourcesPath, 'dist');
	loadURL = serve({
		directory: pathToDist,
		scheme: 'wcpos',
	});
}

let mainWindow: BrowserWindow | null;

const APP_VERSION  = 'POSTir 5.3.0';
const WP_SITE_URL  = 'https://usmm-tir.fr';
const WP_REST_BASE = 'https://usmm-tir.fr/wp-json/wcpos-custom/v1';

export const createWindow = (): void => {
	// Create the browser window.
	mainWindow = new BrowserWindow({
		show: false,
		width: 1406,
		height: 974,
		resizable: false,
		maximizable: false,
		minimizable: true,
		fullscreenable: false,
		title: APP_VERSION,
		icon: path.join(__dirname, '../../icons/icon.ico'),
		autoHideMenuBar: true,
		webPreferences: {
			preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
			sandbox: false,
			nodeIntegration: false,
			contextIsolation: true,
			devTools: true,
		},
		backgroundColor: '#fff',
	});

	// Désactiver le menu natif
	mainWindow.setMenu(null);

	// Raccourci DevTools Ctrl+Maj+I
	mainWindow.webContents.on('before-input-event', (event, input) => {
		if (input.control && input.shift && input.key.toLowerCase() === 'i') {
			mainWindow?.webContents.toggleDevTools();
			event.preventDefault();
		}
	});

	// Logging renderer (filtré Novu)
	mainWindow.webContents.on('console-message', (_e, level, message, line, src) => {
		const short = (src ?? '').split('/').pop() ?? '';
		const tag   = `[R ${short}:${line}]`;
		if (message.includes('Novu') || message.includes('novu') ||
		    message.includes('notifications.wcpos')) return;
		if      (level === 3) log.error(`${tag} ${message}`);
		else if (level === 2) log.warn (`${tag} ${message}`);
		else                  log.info (`${tag} ${message}`);
	});

	// Blocage réseau (pubs, notifications WCPOS)
	mainWindow.webContents.session.webRequest.onBeforeRequest(
		{ urls: [
			'*://*.novu.co/*', '*://novu.co/*',
			'*://updates.wcpos.com/*',
			'*://wcpos.com/*', '*://*.wcpos.com/*',
			'*://api.github.com/repos/wcpos/*',
			'*://*.widgetbot.io/*', '*://widgetbot.io/*',
			'*://via.placeholder.com/*',
			'*://api.notifications.wcpos.com/*',
		] },
		(_d, cb) => cb({ cancel: true })
	);

	// Injection CORS — exclut /wcpos-checkout/ (iframe paiement)
	mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
		{ urls: [WP_SITE_URL + '/*'] },
		(d, cb) => {
			if (d.url.includes('/wcpos-checkout/')) {
				cb({ requestHeaders: d.requestHeaders });
				return;
			}
			cb({ requestHeaders: { ...d.requestHeaders, Origin: 'wcpos://-' } });
		}
	);

	mainWindow.webContents.session.webRequest.onHeadersReceived(
		{ urls: [WP_SITE_URL + '/*'] },
		(d, cb) => {
			if (d.url.includes('/wcpos-checkout/')) {
				cb({ responseHeaders: d.responseHeaders });
				return;
			}
			const h: Record<string, string[]> = {};
			for (const [k, v] of Object.entries(d.responseHeaders ?? {})) {
				if (!['access-control-allow-origin', 'access-control-allow-credentials',
				      'access-control-allow-methods', 'access-control-allow-headers',
				      'x-content-type-options'].includes(k.toLowerCase()))
					h[k] = v as string[];
			}
			h['Access-Control-Allow-Origin']      = ['wcpos://-'];
			h['Access-Control-Allow-Credentials'] = ['true'];
			h['Access-Control-Allow-Methods']     = ['GET, POST, OPTIONS'];
			h['Access-Control-Allow-Headers']     = ['Content-Type, Authorization'];
			cb({ responseHeaders: h });
		}
	);

	if (isDevelopment) {
		mainWindow.webContents.openDevTools();
	}

	// Load the application
	loadURL(mainWindow);

	// Figer le titre
	mainWindow.on('page-title-updated', e => { e.preventDefault(); mainWindow?.setTitle(APP_VERSION); });

	mainWindow.on('ready-to-show', () => {
		if (!mainWindow) {
			throw new Error('"mainWindow" is not defined');
		}
		if (process.env.START_MINIMIZED) {
			mainWindow.minimize();
			mainWindow.show();
		} else {
			mainWindow.maximize();
			mainWindow.show();
		}
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	// Open external URLs in the user's default browser
	// Auth is now handled via IPC in auth-handler.ts
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		log.info(`Opening in external browser: ${url}`);
		shell.openExternal(url);
		return { action: 'deny' };
	});

	// Handle failed loads
	let retryCount = 0;
	const MAX_RETRIES = 30; // ~60 seconds of retries

	mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription) => {
		log.error(`did fail load with code ${errorCode}: ${errorDescription}`);
		if (errorDescription === 'ERR_CONNECTION_REFUSED') {
			if (retryCount >= MAX_RETRIES) {
				log.error('Max retries reached, giving up on dev server connection');
				return;
			}
			retryCount++;
			log.info('Dev server not ready, retrying in 2s...');
			setTimeout(() => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					loadURL(mainWindow);
				}
			}, 2000);
		} else {
			log.error(`Load failed without retry: ${errorDescription}`);
		}
	});
};

export const getMainWindow = (): BrowserWindow | null => {
	return mainWindow;
};
