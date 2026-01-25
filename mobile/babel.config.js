module.exports = api => {
	api.cache(true)

	return {
		presets: ['babel-preset-expo'],

		// other config
		plugins: [
			[
				'react-native-unistyles/plugin',
				{
					root: 'src',
				},
			],
		],
	}
}
