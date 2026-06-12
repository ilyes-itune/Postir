import path from 'path';

import { MakerZIP } from '@electron-forge/maker-zip';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { move, pathExists, remove } from 'fs-extra';

import pkg from './package.json';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
	packagerConfig: {
		name: 'POSTir',
		executableName: 'POSTir',
		appBundleId: 'com.usmm.postir',
		buildVersion: `${pkg.version}`,
		icon: path.resolve(__dirname, 'icons', 'icon'),
		extraResource: [path.resolve(__dirname, 'dist')],
		protocols: [
			{
				name: 'POSTir',
				schemes: ['wcpos'],
			},
		],
	},
	rebuildConfig: {},
	hooks: {
		packageAfterPrune: async () => {
			// build SQLite natif conservé — nécessaire sur Windows
		},
		postMake: async (forgeConfig, makeResults) => {
			for (const result of makeResults) {
				for (const artifactPath of result.artifacts) {
					const parsedPath = path.parse(artifactPath);
					const newBaseName = parsedPath.base.replace(/ /g, '-');
					const newArtifactPath = path.join(parsedPath.dir, newBaseName);
					if (artifactPath !== newArtifactPath) {
						if (await pathExists(newArtifactPath)) {
							await remove(newArtifactPath);
						}
						await move(artifactPath, newArtifactPath);
					}
					result.artifacts = result.artifacts.map((artifact) =>
						artifact === artifactPath ? newArtifactPath : artifact
					);
				}
			}
			return makeResults;
		},
	},
	makers: [
		new MakerZIP({}, ['win32']),
	],
	publishers: [
		new PublisherGithub({
			repository: {
				owner: 'ilyes-itune',
				name: 'Postir',
			},
		}),
	],
	plugins: [
		new WebpackPlugin({
			mainConfig,
			renderer: {
				config: rendererConfig,
				entryPoints: [
					{
						html: './src/index.html',
						js: './src/renderer.ts',
						name: 'main_window',
						preload: {
							js: './src/preload.ts',
						},
					},
				],
			},
		}),
	],
};

export default config;
