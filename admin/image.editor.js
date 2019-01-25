/**
 * Avatar Editor
 *
 * @author Zefau
 * @version 0.1.0
 * @licence MIT
 *
 */
class AvatarEditor
{
	/**
	 * Constructor.
	 *
	 */
    constructor(domId, templateId, errorId)
	{
		this.domId = domId || '#avatars';
		this.templateId = templateId || '.template';
		this.errorId = errorId || '.errorMessage';
		this.avatars = [];
		
		// attach button listeners
		var that = this;
		$('body')
			.on('click', '.avatar-add', function() {that.addAvatar()})
			.on('click', '.avatar-upload', function() {that.uploadAvatar($(this).parents('.avatar'))})
			.on('click', '.avatar-delete', function() {that.deleteAvatar($(this).parents('.avatar'))});
		
		// attach save function
		$('[data-name="name"]').change(function() {onChange()}).keyup(function() {$(this).trigger('change')});
		
		// attach upload
		$('.file-upload').on('change', function(e)
		{
			event.preventDefault();
			that.uploadAvatar(event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0]);
		});
		$(this.domId).find(nodeId).find('.file-upload').trigger('click');
	}
	
	/**
	 * Upload new avatar.
	 *
	 */
	uploadAvatar(event)
	{
		var that = this;
		
		// file too big
		if (file.size > 1000000)
		{
			$(this.errorId).removeClass('hidden').text(_('File is too big!'));
			return false;
		}
		
		//
		var reader = new FileReader();
		reader.onload = function(evt)
		{
			var text;
			try
			{
				text = evt.target.result; // string has form data:;base64,TEXT==
				that.resizeImage(text, function(result)
				{
					var pictures = getPictures();
					pictures[$('#drop-file').data('index')].base64 = result;
					onChange();
					showPictures(pictures);
				});
				
				$(that.errorId).addClass('hidden').text('');
			}
			catch(err)
			{
				console.error(err);
				$(that.errorId).removeClass('hidden').text(_('Cannot read file!'));
			}
		};
		
		reader.readAsDataURL(file);
	}
	
	/**
	 * Resize an image.
	 *
	 */
	resizeImage(srcBase64, callback)
	{
		var maxW   = 64;
		var maxH   = 64;
		var canvas = document.createElement('canvas');
		var ctx    = canvas.getContext('2d');
		var cw     = canvas.width;
		var ch     = canvas.height;

		var img = new Image;
		img.onload = function() {
			var iw        = img.width;
			var ih        = img.height;
			var scale     = Math.min((maxW / iw), (maxH / ih));
			var iwScaled  = iw*scale;
			var ihScaled  = ih*scale;
			canvas.width  = iwScaled;
			canvas.height = ihScaled;
			ctx.drawImage(img,0,0,iwScaled,ihScaled);
			callback(canvas.toDataURL());
		};
		try {
			img.src = srcBase64;
		} catch (e) {
			callback(srcBase64);
		}
	}
	
	/**
	 * Get all avatars.
	 *
	 */
	getAvatars()
	{
		var that = this;
		$(this.domId + ' .avatar').not(this.templateId).each(function(i, avatar)
		{
			that.avatars.push({
				name: $(avatar).find('[data-name="name"]').val(),
				base64: $(avatar).find('.picture > img').attr('src')
			});
		});
	}
	
	/**
	 * Delete an avatar (and refresh avatars).
	 *
	 */
	deleteAvatar(nodeId)
	{
		$(this.domId).find(nodeId).remove();
		this.getAvatars();
	}
	
	/**
	 * Add multiple avatars.
	 *
	 */
	addAvatars(avatars)
	{
		var that = this;
		avatars.forEach(function(avatar) {that.addAvatar(avatar)});
	}
	
	/**
	 * Add new avatar.
	 *
	 */
	addAvatar(avatar)
	{
		var template = $('.avatar' + this.templateId).clone();
		
		if (avatar != undefined && avatar.base64 !== undefined)
			template.find('.picture').append('<img width="64" class="image" src="' + avatar.base64 + '" />')
		
		if (avatar != undefined && avatar.name !== undefined)
			template.find('[data-name="name"]').val(avatar.name);
		
		$(this.domId).append(template.removeClass(this.templateId.replace(/\./gi, ' ') + ' hidden'));
	}

	
	
	
	/**
	 *
	 *
	 */
	setPicture(name, base64)
	{
		var pictures = getPictures();
		var id = 1;
		if (!name) {
			var found;
			do {
				found = false;
				name = _('User') + ' ' + id;
				for (var i = 0; i < pictures.length; i++) {
					if (pictures[i].name === name) {
						found = true;
						id++
					}
				}
			} while (found);
		}

		pictures.push({name: name, base64: base64 || ''});
		onChange();
		showPictures(pictures);
	}
}