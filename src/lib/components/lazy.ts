/** Sets a video's src only once it comes near the screen, so a grid of videos stays light. */
export function lazySrc(node: HTMLVideoElement, src: string) {
	let current = src;
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				node.src = current;
				observer.disconnect();
			}
		},
		{ rootMargin: '400px' }
	);
	observer.observe(node);
	return {
		update(next: string) {
			current = next;
			if (node.src) node.src = next;
		},
		destroy() {
			observer.disconnect();
		}
	};
}
