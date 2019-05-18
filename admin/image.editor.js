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
    constructor(cb, domId, templateId, errorId)
	{
		this.cb = cb || function() {};
		this.domId = domId || '#avatars';
		this.templateId = templateId || '.template';
		this.errorId = errorId || '.errorMessage';
		this.avatars = [];
		
		// attach button listeners
		var that = this;
		$('body')
			.on('click', '.avatar-add', function() {that.addAvatar()})
			.on('click', '.avatar-upload', function(e) {$(e.currentTarget).parents('.avatar').find('.file-upload').trigger('click')})
			.on('click', '.avatar-delete', function() {that.deleteAvatar($(this).parents('.avatar'))})
		
			// attach upload
			.on('change', '.file-upload', function(e)
			{
				e.preventDefault();
				that.uploadAvatar(e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0], $(e.currentTarget).parents('.avatar'));
			})
		
			// attach save function
			.on('change', '[data-name="tid"],[data-name="name"]', function() {that.cb()})
			.on('keyup', '[data-name="tid"],[data-name="name"]', function() {that.cb()});
	}
	
	/**
	 * Upload new avatar.
	 *
	 */
	uploadAvatar(file, element)
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
			var img;
			try
			{
				img = evt.target.result; // string has form data:;base64,TEXT==
				
				// validate image
				if (img.indexOf('data:image') === -1)
				{
					$(that.errorId).removeClass('hidden').text(_('File not an image!'));
					return false;
				}
				
				// resize image
				that.resizeImage(img, function(result)
				{
					that.updAvatar({base64: img}, element);
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
		img.onload = function()
		{
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
		
		try
		{
			img.src = srcBase64;
		}
		catch(e) {callback(srcBase64)}
	}
	
	/**
	 * Get all avatars.
	 *
	 */
	getAvatars()
	{
		var that = this;
		that.avatars = [];
		
		$(this.domId + ' .avatar').not(this.templateId).each(function(i, avatar)
		{
			that.avatars.push({
				tid: $(avatar).find('[data-name="tid"]').val(),
				name: $(avatar).find('[data-name="name"]').val(),
				base64: $(avatar).find('.picture > img').attr('src')
			});
		});
		
		return that.avatars;
	}
	
	/**
	 * Delete an avatar (and refresh avatars).
	 *
	 */
	deleteAvatar(nodeId)
	{
		$(this.domId).find(nodeId).remove();
		this.getAvatars();
		this.cb();
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
		
		if (avatar != undefined && avatar.tid !== undefined)
			template.find('[data-name="tid"]').val(avatar.tid);
		
		if (avatar != undefined && avatar.name !== undefined)
			template.find('[data-name="name"]').val(avatar.name);
		
		$(this.domId).append(template.removeClass(this.templateId.replace(/\./gi, ' ') + ' hidden'));
	}
	
	/**
	 * Update avatar.
	 *
	 */
	updAvatar(avatar, element)
	{
		if (avatar != undefined && avatar.base64 !== undefined)
		{
			element.find('.picture img').remove();
			element.find('.picture').append('<img width="64" class="image" src="' + avatar.base64 + '" />')
		}
		
		if (avatar != undefined && avatar.tid !== undefined)
			element.find('[data-name="tid"]').val(avatar.tid);
		
		if (avatar != undefined && avatar.name !== undefined)
			element.find('[data-name="name"]').val(avatar.name);
		
		this.cb();
	}
}