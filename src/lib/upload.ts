/** Browser side of uploading: one file per request, with progress, and a still for videos. */

export interface UploadResult {
	readonly ok: boolean;
	readonly id?: string;
	readonly error?: string;
}

export function uploadFile(
	fields: FormData,
	onprogress: (fraction: number) => void
): Promise<UploadResult> {
	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/upload');
		xhr.responseType = 'json';
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onprogress(event.loaded / event.total);
		};
		xhr.onload = () => {
			const body = (xhr.response ?? {}) as UploadResult & { message?: string };
			if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, id: body.id });
			else
				resolve({
					ok: false,
					error: body.error ?? body.message ?? `Upload failed (${xhr.status}).`
				});
		};
		xhr.onerror = () => resolve({ ok: false, error: 'The connection dropped.' });
		xhr.send(fields);
	});
}

/** A JPEG of a video's first moments, for its grid thumbnail. Null if the browser can't. */
export function videoPoster(file: File): Promise<Blob | null> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		const done = (blob: Blob | null) => {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
			resolve(blob);
		};
		const timer = setTimeout(() => done(null), 5000);
		video.muted = true;
		video.playsInline = true;
		video.preload = 'auto';
		video.onloadeddata = () => {
			video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
		};
		video.onseeked = () => {
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const context = canvas.getContext('2d');
			if (!context || !canvas.width) return done(null);
			context.drawImage(video, 0, 0);
			canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.82);
		};
		video.onerror = () => done(null);
		video.src = url;
	});
}

/** File types the picker offers; the server checks the real bytes anyway. */
export const ACCEPT =
	'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime';
