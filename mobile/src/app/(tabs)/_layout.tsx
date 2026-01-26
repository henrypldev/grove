import { NativeTabs } from 'expo-router/unstable-native-tabs'

export default function TabLayout() {
	return (
		<NativeTabs>
			<NativeTabs.Trigger name="index">
				<NativeTabs.Trigger.Icon
					sf={{ default: 'terminal', selected: 'terminal.fill' }}
					md="terminal"
				/>
				<NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="repos">
				<NativeTabs.Trigger.Icon
					sf={{ default: 'folder', selected: 'folder.fill' }}
					md="folder"
				/>
				<NativeTabs.Trigger.Label>Repos</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings">
				<NativeTabs.Trigger.Icon
					sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
					md="settings"
				/>
				<NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	)
}
