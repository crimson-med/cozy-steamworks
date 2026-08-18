import * as steamworks from "@cozycoast/steamworks.js";

export default function main() {
	const client = steamworks.init(480);
	console.log(client.localplayer.getName())
}
