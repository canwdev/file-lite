((exports) => {

	const looksLikeChrome = !!(window.chrome && (window.chrome.loadTimes || window.chrome.csi));
	// NOTE: Microsoft Edge includes window.chrome.app
	// (also this browser detection logic could likely use some more nuance)

	const menus = {
		[localize("&File")]: [
			{
				item: localize("&New"),
				shortcut: window.is_electron_app ? "Ctrl+N" : "Ctrl+Alt+N", // Ctrl+N opens a new browser window
				action: () => { file_new(); },
				description: localize("Creates a new document."),
			},
			{
				item: localize("&Open"),
				shortcut: "Ctrl+O",
				action: () => { file_open(); },
				description: localize("Opens an existing document."),
			},
			{
				item: localize("&Save"),
				shortcut: "Ctrl+S",
				action: () => { file_save(); },
				description: localize("Saves the active document."),
			},
			{
				item: localize("Save &As"),
				// in mspaint, no shortcut is listed; it supports F12 (but in a browser that opens the dev tools)
				// it doesn't support Ctrl+Shift+S but that's a good & common modern shortcut
				shortcut: "Ctrl+Shift+S",
				action: () => { file_save_as(); },
				description: localize("Saves the active document with a new name."),
			},
			MENU_DIVIDER,
			{
				item: localize("Manage Storage"),
				action: () => { manage_storage(); },
				description: localize("Manages storage of previously created or opened pictures."),
			},
			MENU_DIVIDER,
			{
				item: localize("&Print"),
				shortcut: "Ctrl+P", // relies on browser's print shortcut being Ctrl+P
				action: () => {
					print();
				},
				description: localize("Prints the active document and sets printing options."),
			},
			MENU_DIVIDER,
			{
				item: localize("E&xit"),
				action: () => {
					window.close();
				},
				description: localize("Quits Paint."),
			},
		],
		[localize("&Edit")]: [
			{
				item: localize("&Undo"),
				shortcut: "Ctrl+Z",
				enabled: () => undos.length >= 1,
				action: () => { undo(); },
				description: localize("Undoes the last action."),
			},
			{
				item: localize("&Repeat"),
				shortcut: "F4", // also supported: Ctrl+Shift+Z, Ctrl+Y
				enabled: () => redos.length >= 1,
				action: () => { redo(); },
				description: localize("Redoes the previously undone action."),
			},
			{
				item: localize("&History"),
				shortcut: "Ctrl+Shift+Y",
				action: () => { show_document_history(); },
				description: localize("Shows the document history and lets you navigate to states not accessible with Undo or Repeat."),
			},
			MENU_DIVIDER,
			{
				item: localize("Cu&t"),
				shortcut: "Ctrl+X",
				enabled: () =>
					// @TODO: support cutting text with this menu item as well (e.g. for the text tool)
					!!selection,
				action: () => {
					edit_cut(true);
				},
				description: localize("Cuts the selection and puts it on the Clipboard."),
			},
			{
				item: localize("&Copy"),
				shortcut: "Ctrl+C",
				enabled: () =>
					// @TODO: support copying text with this menu item as well (e.g. for the text tool)
					!!selection,
				action: () => {
					edit_copy(true);
				},
				description: localize("Copies the selection and puts it on the Clipboard."),
			},
			{
				item: localize("&Paste"),
				shortcut: "Ctrl+V",
				enabled: () =>
					// @TODO: disable if nothing in clipboard or wrong type (if we can access that)
					true,
				action: () => {
					edit_paste(true);
				},
				description: localize("Inserts the contents of the Clipboard."),
			},
			{
				item: localize("C&lear Selection"),
				shortcut: "Del",
				enabled: () => !!selection,
				action: () => { delete_selection(); },
				description: localize("Deletes the selection."),
			},
			{
				item: localize("Select &All"),
				shortcut: "Ctrl+A",
				action: () => { select_all(); },
				description: localize("Selects everything."),
			},
			MENU_DIVIDER,
			{
				item: `${localize("C&opy To")}...`,
				enabled: () => !!selection,
				action: () => { save_selection_to_file(); },
				description: localize("Copies the selection to a file."),
			},
			{
				item: `${localize("Paste &From")}...`,
				action: () => { choose_file_to_paste(); },
				description: localize("Pastes a file into the selection."),
			}
		],
		[localize("&View")]: [
			{
				item: localize("&Tool Box"),
				shortcut: window.is_electron_app ? "Ctrl+T" : "", // Ctrl+T opens a new browser tab, Ctrl+Alt+T opens a Terminal in Ubuntu, and Ctrl+Shift+Alt+T feels silly.
				checkbox: {
					toggle: () => {
						$toolbox.toggle();
					},
					check: () => $toolbox.is(":visible"),
				},
				description: localize("Shows or hides the tool box."),
			},
			{
				item: localize("&Color Box"),
				shortcut: "Ctrl+L", // focuses browser address bar, but Firefox and Chrome both allow overriding the default behavior
				checkbox: {
					toggle: () => {
						$colorbox.toggle();
					},
					check: () => $colorbox.is(":visible"),
				},
				description: localize("Shows or hides the color box."),
			},
			{
				item: localize("&Status Bar"),
				checkbox: {
					toggle: () => {
						$status_area.toggle();
					},
					check: () => $status_area.is(":visible"),
				},
				description: localize("Shows or hides the status bar."),
			},
			{
				item: localize("T&ext Toolbar"),
				enabled: false, // @TODO: toggle fonts box
				checkbox: {},
				description: localize("Shows or hides the text toolbar."),
			},
			MENU_DIVIDER,
			{
				item: localize("&Zoom"),
				submenu: [
					{
						item: localize("&Normal Size"),
						shortcut: window.is_electron_app ? "Ctrl+PgUp" : "", // Ctrl+PageUp cycles thru browser tabs in Chrome & Firefox; can be overridden in Chrome in fullscreen only
						speech_recognition: [
							"reset zoom", "zoom to normal size",
							"zoom to 100%", "set zoom to 100%", "set zoom 100%",
							"zoom to 1x", "set zoom to 1x", "set zoom 1x",
							"zoom level to 100%", "set zoom level to 100%", "set zoom level 100%",
							"zoom level to 1x", "set zoom level to 1x", "set zoom level 1x",
						],
						description: localize("Zooms the picture to 100%."),
						enabled: () => magnification !== 1,
						action: () => {
							set_magnification(1);
						},
					},
					{
						item: localize("&Large Size"),
						shortcut: window.is_electron_app ? "Ctrl+PgDn" : "", // Ctrl+PageDown cycles thru browser tabs in Chrome & Firefox; can be overridden in Chrome in fullscreen only
						speech_recognition: [
							"zoom to large size",
							"zoom to 400%", "set zoom to 400%", "set zoom 400%",
							"zoom to 4x", "set zoom to 4x", "set zoom 4x",
							"zoom level to 400%", "set zoom level to 400%", "set zoom level 400%",
							"zoom level to 4x", "set zoom level to 4x", "set zoom level 4x",
						],
						description: localize("Zooms the picture to 400%."),
						enabled: () => magnification !== 4,
						action: () => {
							set_magnification(4);
						},
					},
					{
						item: localize("Zoom To &Window"),
						speech_recognition: [
							"zoom to window", "zoom to view",
							"zoom to fit",
							"zoom to fit within window", "zoom to fit within view",
							"zoom to fit within the window", "zoom to fit within the view",
							"zoom to fit in window", "zoom to fit in view",
							"zoom to fit in the window", "zoom to fit in the view",
							"auto zoom", "fit zoom",
							"zoom to max", "zoom to maximum", "zoom to max size", "zoom to maximum size",
							"zoom so canvas fits", "zoom so picture fits", "zoom so image fits", "zoom so document fits",
							"zoom so whole canvas is visible", "zoom so whole picture is visible", "zoom so whole image is visible", "zoom so whole document is visible",
							"zoom so the whole canvas is visible", "zoom so the whole picture is visible", "zoom so the whole image is visible", "zoom so the whole document is visible",

							"fit to window", "fit to view", "fit in window", "fit in view", "fit within window", "fit within view",
							"fit picture to window", "fit picture to view", "fit picture in window", "fit picture in view", "fit picture within window", "fit picture within view",
							"fit image to window", "fit image to view", "fit image in window", "fit image in view", "fit image within window", "fit image within view",
							"fit canvas to window", "fit canvas to view", "fit canvas in window", "fit canvas in view", "fit canvas within window", "fit canvas within view",
							"fit document to window", "fit document to view", "fit document in window", "fit document in view", "fit document within window", "fit document within view",
						],
						description: localize("Zooms the picture to fit within the view."),
						action: () => {
							const rect = $canvas_area[0].getBoundingClientRect();
							const margin = 30; // leave a margin so scrollbars won't appear
							let mag = Math.min(
								(rect.width - margin) / main_canvas.width,
								(rect.height - margin) / main_canvas.height,
							);
							// round to an integer percent for the View > Zoom > Custom... dialog, which shows non-integers as invalid
							mag = Math.floor(100 * mag) / 100;
							set_magnification(mag);
						},
					},
					{
						item: `${localize("C&ustom")}...`,
						description: localize("Zooms the picture."),
						speech_recognition: [
							"zoom custom", "custom zoom", "set custom zoom", "set custom zoom level", "zoom to custom level", "zoom to custom", "zoom level", "set zoom level",
						],
						action: () => { show_custom_zoom_window(); },
					},
					MENU_DIVIDER,
					{
						item: localize("Show &Grid"),
						shortcut: "Ctrl+G",
						speech_recognition: [
							"toggle show grid",
							"toggle grid", "toggle gridlines", "toggle grid lines", "toggle grid cells",
							// @TODO: hide/show
						],
						enabled: () => magnification >= 4,
						checkbox: {
							toggle: () => { toggle_grid(); },
							check: () => show_grid,
						},
						description: localize("Shows or hides the grid."),
					},
					{
						item: localize("Show T&humbnail"),
						speech_recognition: [
							"toggle show thumbnail",
							"toggle thumbnail", "toggle thumbnail view", "toggle thumbnail box", "toggle thumbnail window",
							"toggle preview", "toggle image preview", "toggle picture preview",
							"toggle picture in picture", "toggle picture in picture view", "toggle picture in picture box", "toggle picture in picture window",
							// @TODO: hide/show
						],
						checkbox: {
							toggle: () => { toggle_thumbnail(); },
							check: () => show_thumbnail,
						},
						description: localize("Shows or hides the thumbnail view of the picture."),
					}
				]
			},
			{
				item: localize("&View Bitmap"),
				shortcut: "Ctrl+F",
				action: () => { view_bitmap(); },
				description: localize("Displays the entire picture."),
			},
			MENU_DIVIDER,
			{
				item: localize("&Fullscreen"),
				shortcut: "F11", // relies on browser's shortcut
				enabled: () => document.fullscreenEnabled || document.webkitFullscreenEnabled,
				checkbox: {
					check: () => document.fullscreenElement || document.webkitFullscreenElement,
					toggle: () => {
						if (document.fullscreenElement || document.webkitFullscreenElement) {
							if (document.exitFullscreen) { document.exitFullscreen(); }
							else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
						} else {
							if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen(); }
							else if (document.documentElement.webkitRequestFullscreen) { document.documentElement.webkitRequestFullscreen(); }
						}
						// check() would need to be async or faked with a timeout,
						// if the menus stayed open. @TODO: make all checkboxes close menus
						menu_bar.closeMenus();
					},
				},
				description: localize("Makes the application take up the entire screen."),
			},
		],
		[localize("&Image")]: [
			// @TODO: speech recognition: terms that apply to selection
			{
				item: localize("&Flip/Rotate"),
				shortcut: (window.is_electron_app && !window.electron_is_dev) ? "Ctrl+R" : "Ctrl+Alt+R", // Ctrl+R reloads the browser tab (or Electron window in dev mode via electron-debug)
				action: () => { image_flip_and_rotate(); },
				description: localize("Flips or rotates the picture or a selection."),
			},
			{
				item: localize("&Stretch/Skew"),
				shortcut: window.is_electron_app ? "Ctrl+W" : "Ctrl+Alt+W", // Ctrl+W closes the browser tab
				action: () => { image_stretch_and_skew(); },
				description: localize("Stretches or skews the picture or a selection."),
			},
			{
				item: localize("&Invert Colors"),
				shortcut: "Ctrl+I",
				action: () => { image_invert_colors(); },
				description: localize("Inverts the colors of the picture or a selection."),
			},
			{
				item: `${localize("&Attributes")}...`,
				shortcut: "Ctrl+E",
				action: () => { image_attributes(); },
				description: localize("Changes the attributes of the picture."),
			},
			{
				item: localize("&Clear Image"),
				shortcut: (window.is_electron_app || !looksLikeChrome) ? "Ctrl+Shift+N" : "", // Ctrl+Shift+N opens incognito window in chrome
				// (mspaint says "Ctrl+Shft+N")
				action: () => { !selection && clear(); },
				enabled: () => !selection,
				description: localize("Clears the picture."),
				// action: ()=> {
				// 	if (selection) {
				// 		delete_selection();
				// 	} else {
				// 		clear();
				// 	}
				// },
				// mspaint says localize("Clears the picture or selection."), but grays out the option when there's a selection
			},
			{
				item: localize("&Draw Opaque"),
				checkbox: {
					toggle: () => {
						tool_transparent_mode = !tool_transparent_mode;
						$G.trigger("option-changed");
					},
					check: () => !tool_transparent_mode,
				},
				description: localize("Makes the current selection either opaque or transparent."),
			}
		],
		[localize("&Colors")]: [
			{
				item: `${localize("&Edit Colors")}...`,
				action: () => {
					show_edit_colors_window();
				},
				description: localize("Creates a new color."),
			},
		],
		[localize("&Help")]: [
			{
				item: localize("&About Paint"),
				action: () => { show_about_paint(); },
				description: localize("Displays information about this application."),
			}
		],
		[localize("E&xtras")]: [
			{
				item: localize("&Language"),
				submenu: available_languages.map((available_language) => (
					{
						item: get_language_emoji(available_language) + " " + get_language_endonym(available_language),
						action: () => {
							set_language(available_language);
						},
						enabled: () => get_language() != available_language,
						description: localize("Changes the language to %1.", get_iso_language_name(available_language)),
					}
				)),
			},
			{
				item: localize("&Vertical Color Box"),
				checkbox: {
					toggle: () => {
						if (location.hash.match(/vertical-color-box-mode/i)) {
							change_url_param("vertical-color-box-mode", false);
						} else {
							change_url_param("vertical-color-box-mode", true);
						}
					},
					check: () => {
						return location.hash.match(/vertical-color-box-mode/i);
					},
				},
				description: localize("Arranges the color box vertically."),
			},
		],
	};

	for (const [top_level_menu_key, menu] of Object.entries(menus)) {
		const top_level_menu_name = top_level_menu_key.replace(/&/, "");
		const add_literal_navigation_speech_recognition = (menu, ancestor_names) => {
			for (const menu_item of menu) {
				if (menu_item !== MENU_DIVIDER) {
					const menu_item_name = menu_item.item.replace(/&|\.\.\.|\(|\)/g, "");
					// console.log(menu_item_name);
					let menu_item_matchers = [menu_item_name];
					if (menu_item_name.match(/\//)) {
						menu_item_matchers = [
							menu_item_name,
							menu_item_name.replace(/\//, " "),
							menu_item_name.replace(/\//, " and "),
							menu_item_name.replace(/\//, " or "),
							menu_item_name.replace(/\//, " slash "),
						];
					}
					menu_item_matchers = menu_item_matchers.map((menu_item_matcher) => {
						return `${ancestor_names} ${menu_item_matcher}`;
					});
					menu_item.speech_recognition = (menu_item.speech_recognition || []).concat(menu_item_matchers);
					// console.log(menu_item_matchers, menu_item.speech_recognition);

					if (menu_item.submenu) {
						add_literal_navigation_speech_recognition(menu_item.submenu, `${ancestor_names} ${menu_item_name}`);
					}
				}
			}
		};
		add_literal_navigation_speech_recognition(menu, top_level_menu_name);
	}

	exports.menus = menus;

})(window);
