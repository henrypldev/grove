// import { usePathname } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'

export default function TabLayout() {
	// const pathname = usePathname()
	// console.log(pathname)

	// const getSearchIcon = () => {
	// 	if (pathname === '/') {
	// 		return {
	// 			default: 'apple.terminal.on.rectangle',
	// 			selected: 'apple.terminal.on.rectangle.fill',
	// 		}
	// 	} else if (pathname === '/repos') {
	// 		return {
	// 			default: 'folder.badge.plus',
	// 			selected: 'folder.fill.badge.plus',
	// 		}
	// 	}
	// }

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
