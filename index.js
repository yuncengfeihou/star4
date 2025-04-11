// public/extensions/third-party/favorites-plugin/index_new.js

// Import from the core script
import {
    eventSource,
    event_types,
    toastr,
    messageFormatting,
    chat,                     // 用于访问聊天记录
    clearChat,                // 用于清空聊天
    doNewChat,                // 用于创建新聊天
    openCharacterChat,        // 用于打开角色聊天
    renameChat                // 用于重命名聊天
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced
} from '../../../extensions.js';

// Import from the Popup utility script
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import for group chats
import { openGroupChat } from "../../../group-chats.js";

// Import from the general utility script
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// Define plugin folder name (important for consistency)
const pluginName = 'star4';

// Initialize plugin settings if they don't exist
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}

// Define HTML for the favorite toggle icon
const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// Store reference to the favorites popup
let favoritesPopup = null;
// Current pagination state
let currentPage = 1;
const itemsPerPage = 5;

/**
 * Ensures the favorites array exists in the current chat metadata accessed via getContext()
 * @returns {object | null} The chat metadata object if available and favorites array is ensured, null otherwise.
 */
function ensureFavoritesArrayExists() {
    let context;
    try {
        context = getContext();
        // 检查 context 和 context.chatMetadata 是否有效
        if (!context || !context.chatMetadata) {
            console.error(`${pluginName}: ensureFavoritesArrayExists - context or context.chatMetadata is not available!`);
            return null; // 返回 null 表示失败
        }
    } catch (e) {
        console.error(`${pluginName}: ensureFavoritesArrayExists - Error calling getContext():`, e);
        return null; // 返回 null 表示失败
    }

    // 使用 context 返回的元数据对象
    const chatMetadata = context.chatMetadata;

    // 检查 favorites 属性是否为数组，如果不是或不存在，则初始化为空数组
    if (!Array.isArray(chatMetadata.favorites)) {
        console.log(`${pluginName}: Initializing chatMetadata.favorites array.`);
        chatMetadata.favorites = [];
        // 注意：初始化后，chatMetadata 对象本身被修改了，后续保存时会保存这个修改
    }
    return chatMetadata; // 返回有效的元数据对象
}


/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    console.log(`${pluginName}: addFavorite 函数开始执行，接收到的 messageInfo:`, messageInfo);

    const chatMetadata = ensureFavoritesArrayExists(); // 获取元数据对象
    if (!chatMetadata) { // 检查是否获取成功
         console.error(`${pluginName}: addFavorite - 获取 chatMetadata 失败，退出`);
         return;
    }

    // 创建收藏项 (已移除 timestamp)
    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId,
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };

    // 确保 favorites 是数组 (理论上 ensureFavoritesArrayExists 已保证，但多一层防护)
    if (!Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: addFavorite - chatMetadata.favorites 不是数组，无法添加！`);
        return;
    }

    console.log(`${pluginName}: 添加前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    chatMetadata.favorites.push(item); // 修改获取到的元数据对象的 favorites 数组
    console.log(`${pluginName}: 添加后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

    console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced(); // 调用导入的保存函数

    console.log(`${pluginName}: Added favorite:`, item);

    // 修改这里：使用正确的方法检查弹窗是否可见
    if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
        updateFavoritesPopup();
    }
}

/**
 * Removes a favorite by its ID
 * @param {string} favoriteId The ID of the favorite to remove
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteById(favoriteId) {
    console.log(`${pluginName}: removeFavoriteById - 尝试删除 ID: ${favoriteId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    // 检查 chatMetadata 和 favorites 数组是否有效且不为空
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        console.warn(`${pluginName}: removeFavoriteById - chatMetadata 无效或 favorites 数组为空`);
        return false;
    }

    const indexToRemove = chatMetadata.favorites.findIndex(fav => fav.id === favoriteId);
    if (indexToRemove !== -1) {
        console.log(`${pluginName}: 删除前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
        chatMetadata.favorites.splice(indexToRemove, 1);
        console.log(`${pluginName}: 删除后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存删除...`);
        saveMetadataDebounced(); // 调用导入的保存函数
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        return true;
    }

    console.warn(`${pluginName}: Favorite with id ${favoriteId} not found.`);
    return false;
}

/**
 * Removes a favorite by the message ID it references
 * @param {string} messageId The message ID (from mesid attribute)
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    console.log(`${pluginName}: removeFavoriteByMessageId - 尝试删除 messageId: ${messageId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: removeFavoriteByMessageId - chatMetadata 无效或 favorites 数组为空`);
         return false;
    }

    // 根据 messageId 查找收藏项
    const favItem = chatMetadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
        // 如果找到，调用按 favoriteId 删除的函数
        return removeFavoriteById(favItem.id);
    }

    console.warn(`${pluginName}: Favorite for messageId ${messageId} not found.`);
    return false;
}

/**
 * Updates the note for a favorite item
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 */
function updateFavoriteNote(favoriteId, note) {
    console.log(`${pluginName}: updateFavoriteNote - 尝试更新 ID: ${favoriteId} 的备注`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: updateFavoriteNote - chatMetadata 无效或 favorites 数组为空`);
         return;
    }

    const favorite = chatMetadata.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        favorite.note = note;
        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存备注更新...`);
        saveMetadataDebounced(); // 调用导入的保存函数
        console.log(`${pluginName}: Updated note for favorite ${favoriteId}`);
    } else {
        console.warn(`${pluginName}: updateFavoriteNote - Favorite with id ${favoriteId} not found.`);
    }
}

/**
 * Handles the toggle of favorite status when clicking the star icon
 * @param {Event} event The click event
 */
function handleFavoriteToggle(event) {
    // 使用顶层定义的 pluginName
    console.log(`${pluginName}: handleFavoriteToggle - 开始执行`);

    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) {
        console.log(`${pluginName}: handleFavoriteToggle - 退出：未找到 .favorite-toggle-icon`);
        return;
    }

    const messageElement = target.closest('.mes');
    if (!messageElement || !messageElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：无法找到父级 .mes 元素`);
        return;
    }

    const messageIdString = messageElement.attr('mesid');
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：未找到 mesid 属性`);
        return;
    }

    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：mesid 解析为 NaN: ${messageIdString}`);
        return;
    }

    console.log(`${pluginName}: handleFavoriteToggle - 获取 context 和消息对象 (索引: ${messageIndex})`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat) {
            console.error(`${pluginName}: handleFavoriteToggle - 退出：getContext() 返回无效或缺少 chat 属性`);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：调用 getContext() 时出错:`, e);
        return;
    }

    const message = context.chat[messageIndex];
    if (!message) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在索引 ${messageIndex} 未找到消息对象 (来自 mesid ${messageIdString})`);
        return;
    }

    console.log(`${pluginName}: handleFavoriteToggle - 成功获取消息对象:`, message);

    const iconElement = target.find('i');
    if (!iconElement || !iconElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在 .favorite-toggle-icon 内未找到 i 元素`);
        return;
    }
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');

    console.log(`${pluginName}: handleFavoriteToggle - 更新 UI，当前状态 (isFavorited): ${isCurrentlyFavorited}`);
    if (isCurrentlyFavorited) {
        iconElement.removeClass('fa-solid').addClass('fa-regular');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：取消收藏 (regular icon)`);
    } else {
        iconElement.removeClass('fa-regular').addClass('fa-solid');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：收藏 (solid icon)`);
    }

    if (!isCurrentlyFavorited) {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 addFavorite`);
        const messageInfo = {
            messageId: messageIdString,
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
        };
        console.log(`${pluginName}: handleFavoriteToggle - addFavorite 参数:`, messageInfo);
        try {
            addFavorite(messageInfo);
            console.log(`${pluginName}: handleFavoriteToggle - addFavorite 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 addFavorite 时出错:`, e);
        }
    } else {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 removeFavoriteByMessageId`);
        console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 参数: ${messageIdString}`);
        try {
            removeFavoriteByMessageId(messageIdString);
            console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 removeFavoriteByMessageId 时出错:`, e);
        }
    }

    console.log(`${pluginName}: handleFavoriteToggle - 执行完毕`);
}

/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 */
function addFavoriteIconsToMessages() {
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
            // console.log(`${pluginName}: Added favorite icon to message ${messageElement.attr('mesid')}`); // 可以取消注释以调试
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    // 如果无法获取元数据，或者元数据中没有 favorites 数组，则退出
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取有效的 chatMetadata 或 favorites 数组`);
        // 即使没有收藏，也要确保图标是空心状态
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }

    // 确保所有消息都有图标结构
    addFavoriteIconsToMessages();

    // 更新图标状态
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid');

        if (messageId) {
            // 使用 chatMetadata.favorites 进行检查
            const isFavorited = chatMetadata.favorites.some(fav => fav.messageId === messageId);

            const iconElement = messageElement.find('.favorite-toggle-icon i');
            if (iconElement.length) {
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    // 注意：此函数可能需要根据 handleClearInvalidFavorites 的修改进行调整
    // 如果 favItem.messageId 现在存储的是索引，那么查找 message 的方式需要改变
    // 但目前根据 handleFavoriteToggle，messageId 存储的仍然是 mesid 字符串
    if (!favItem) return '';

    const context = getContext();
    // 尝试使用 messageId (mesid 字符串) 找到对应的消息索引
    const messageIndex = parseInt(favItem.messageId, 10);
    let message = null;
    if (!isNaN(messageIndex) && context.chat && context.chat[messageIndex]) {
         // 检查索引是否有效，并检查消息的 mesid 是否真的匹配 (更健壮)
         if (String($(context.chat[messageIndex]).attr?.('mesid')) === favItem.messageId || !$(context.chat[messageIndex]).attr?.('mesid')) { // 容错处理
             message = context.chat[messageIndex];
         }
    }
    // 如果通过索引找不到，尝试按原始的 msg.id == fav.messageId 查找 (兼容旧逻辑或潜在的数据不一致)
    if (!message && context.chat) {
        message = context.chat.find(msg => String(msg.id) === String(favItem.messageId));
    }

    let previewText = '';
    let deletedClass = '';

    if (message && message.mes) { // 增加对 message.mes 的检查
        previewText = message.mes; // <--- 直接获取完整的消息内容

        try {
             // 现在 messageFormatting 会接收到完整的 previewText
             previewText = messageFormatting(previewText, favItem.sender, false,
                                            favItem.role === 'user', null, {}, false);
        } catch (e) {
             console.error(`${pluginName}: Error formatting message preview:`, e);
             // Fallback 也使用完整的原始文本，不再截断
             previewText = message.mes; // Fallback to plain full text if formatting fails
        }
    } else {
        previewText = '[消息内容不可用或已删除]'; // 更清晰的提示
        deletedClass = 'deleted';
    }

    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${favItem.sender} (${favItem.role})</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${favItem.note || ''}</div>
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!favoritesPopup || !chatMetadata) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready or chatMetadata missing.`);
        return;
    }

    // --- 调试日志：确认 favoritesPopup 和 favoritesPopup.content 是否有效 ---
    if (!favoritesPopup.content) {
        console.error(`${pluginName}: updateFavoritesPopup - favoritesPopup.content is null or undefined! Cannot update.`);
        return;
    }
    console.log(`${pluginName}: updateFavoritesPopup - favoritesPopup.content element:`, favoritesPopup.content);
    // --- 调试日志结束 ---

    const context = getContext();
    const chatName = context.characterId ? context.name2 : `群组: ${context.groups.find(g => g.id === context.groupId)?.name || '未命名群组'}`;
    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => parseInt(b.messageId) - parseInt(a.messageId)) : [];

    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
                ${totalFavorites > 0 ? '<button class="menu_button preview-favorites-btn">预览收藏</button>' : ''}
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            contentHtml += renderFavoriteItem(favItem, startIndex + index);
        });

        if (totalPages > 1) {
            contentHtml += `<div class="favorites-pagination">`;
            contentHtml += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            contentHtml += `<span>${currentPage} / ${totalPages}</span>`;
            contentHtml += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            contentHtml += `</div>`;
        }
    }

    contentHtml += `
            </div>
            <div class="favorites-footer">
                <button class="menu_button clear-invalid">清理无效收藏</button>
                <button class="menu_button close-popup">关闭</button>
            </div>
        </div>
    `;

    // --- 修改：直接设置 innerHTML ---
    try {
        favoritesPopup.content.innerHTML = contentHtml; // 直接修改 DOM 元素的 innerHTML
        console.log(`${pluginName}: Popup content updated using innerHTML.`);
    } catch (error) {
         console.error(`${pluginName}: Error setting popup innerHTML:`, error);
    }
    // --- 修改结束 ---

    // favoritesPopup.setContent(contentHtml); // 不再使用 setContent
}

/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        // Create a new popup if it doesn't exist
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>',
                POPUP_TYPE.TEXT,
                '',
                {
                    title: '收藏管理',
                    wide: true,
                    okButton: false,
                    cancelButton: false,
                    allowVerticalScrolling: true
                }
            );

            console.log(`${pluginName}: Popup instance created successfully.`);

            // 将事件监听器附加到 popup 的内容容器 (favoritesPopup.content) 上
            $(favoritesPopup.content).on('click', function(event) {
                const target = $(event.target);

                // 注意：这里的事件处理逻辑应该保持不变，因为它是在 content 容器内部查找元素

                // Handle pagination
                if (target.hasClass('pagination-prev')) {
                    if (currentPage > 1) {
                        currentPage--;
                        updateFavoritesPopup();
                    }
                } else if (target.hasClass('pagination-next')) {
                    const chatMetadata = ensureFavoritesArrayExists();
                    const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                    if (currentPage < totalPages) {
                        currentPage++;
                        updateFavoritesPopup();
                    }
                }
                // Handle preview button
                else if (target.hasClass('preview-favorites-btn')) {
                    handlePreviewButtonClick();
                }
                // Handle close button
                else if (target.hasClass('close-popup')) {
                    favoritesPopup.hide();
                }
                // Handle clear invalid button
                else if (target.hasClass('clear-invalid')) {
                    handleClearInvalidFavorites();
                }
                // Handle edit note (pencil icon)
                else if (target.hasClass('fa-pencil')) {
                    const favItem = target.closest('.favorite-item');
                    // 添加检查 favItem 是否存在
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         handleEditNote(favId);
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                // Handle delete favorite (trash icon)
                else if (target.hasClass('fa-trash')) {
                    const favItem = target.closest('.favorite-item');
                     // 添加检查 favItem 是否存在
                    if (favItem && favItem.length) {
                        const favId = favItem.data('fav-id');
                        const msgId = favItem.data('msg-id');
                        handleDeleteFavoriteFromPopup(favId, msgId);
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null;
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
    }

    currentPage = 1;
    updateFavoritesPopup(); // 这个函数内部会设置 content

    if (favoritesPopup) {
        try {
            favoritesPopup.show();
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
             // 可以尝试重置 favoritesPopup，以便下次重新创建
             // favoritesPopup = null;
        }
    }
}

/**
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.YES) {
        if (removeFavoriteById(favId)) { // 这个函数会处理保存
            updateFavoritesPopup(); // 更新弹窗列表

            // 更新主聊天界面对应消息的图标状态
            const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    }
}

/**
 * Handles editing the note for a favorite
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) return;

    const favorite = chatMetadata.favorites.find(fav => fav.id === favId);
    if (!favorite) return;

    const result = await callGenericPopup('为这条收藏添加备注:', POPUP_TYPE.INPUT, favorite.note || '');

    // 检查用户是否点击了确定并且输入了内容（允许空字符串）
    if (result !== null && result !== POPUP_RESULT.CANCELLED) {
        updateFavoriteNote(favId, result); // 这个函数会处理保存
        updateFavoritesPopup(); // 更新弹窗列表以显示新备注
    }
}

/**
 * Clears invalid favorites (those referencing deleted messages)
 * 修正查找逻辑以匹配 messageId (mesid string)
 */
async function handleClearInvalidFavorites() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        toastr.info('当前没有收藏项可清理。');
        return;
    }

    const context = getContext();
    if (!context || !context.chat) {
         toastr.error('无法获取当前聊天信息以清理收藏。');
         return;
    }

    const invalidFavoritesIds = []; // 存储无效收藏的 ID
    const validFavorites = []; // 存储有效的收藏项

    chatMetadata.favorites.forEach(fav => {
        const messageIndex = parseInt(fav.messageId, 10);
        let messageExists = false;
        // 优先通过索引检查
        if (!isNaN(messageIndex) && context.chat[messageIndex]) {
            // 可选：更严格的检查，确认索引处的 mesid 确实匹配
             if (String($(context.chat[messageIndex]).attr?.('mesid')) === fav.messageId || !$(context.chat[messageIndex]).attr?.('mesid')) {
                 messageExists = true;
             }
        }
        // 如果索引无效或不匹配，尝试按 msg.id 查找 (兼容性)
        if (!messageExists) {
             messageExists = context.chat.some(msg => String(msg.id) === String(fav.messageId));
        }

        if (messageExists) {
            validFavorites.push(fav); // 保留有效的
        } else {
            invalidFavoritesIds.push(fav.id); // 记录无效的 ID
        }
    });

    if (invalidFavoritesIds.length === 0) {
        toastr.info('没有找到无效的收藏项。');
        return;
    }

    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavoritesIds.length} 条引用无效或已删除消息的收藏项。确定要删除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM
    );

    if (confirmResult === POPUP_RESULT.YES) {
        chatMetadata.favorites = validFavorites; // 直接用有效列表替换
        saveMetadataDebounced(); // 保存更改

        toastr.success(`已成功清理 ${invalidFavoritesIds.length} 条无效收藏。`);
        updateFavoritesPopup(); // 更新弹窗
    }
}

// --- 预览功能 ---

/**
 * 确保预览聊天的数据存在
 * @returns {object} 包含当前聊天和角色/群组信息
 */
function ensurePreviewData() {
    // 获取当前聊天和角色/群组信息
    const context = getContext();
    const chatId = context.chatId;
    const characterId = context.characterId;
    const groupId = context.groupId;
    
    // 确保预览聊天ID存储位置存在
    if (!extension_settings[pluginName].previewChats) {
        extension_settings[pluginName].previewChats = {};
    }
    
    return {
        chatId,
        characterId,
        groupId
    };
}

/**
 * 处理预览按钮点击
 * 创建一个新聊天，展示所有收藏的消息
 */
async function handlePreviewButtonClick() {
    console.log(`${pluginName}: 预览按钮被点击`);
    
    try {
        const context = getContext();
        // 检查是否有角色或群组被选中
        if (!context.groupId && context.characterId === undefined) {
            console.error(`${pluginName}: 错误: 没有选择角色或群组`);
            toastr.error('请先选择一个角色或群组');
            return;
        }

        // 获取当前上下文和收藏数据
        const { chatId, characterId, groupId } = ensurePreviewData();
        
        // 获取收藏项列表
        const chatMetadata = ensureFavoritesArrayExists();
        if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
            toastr.warning('没有收藏的消息可以预览');
            return;
        }
        
        console.log(`${pluginName}: 当前聊天收藏消息数量: ${chatMetadata.favorites.length}`);
        
        // 获取原始聊天消息
        const originalChat = [...chat];
        console.log(`${pluginName}: 原始聊天总消息数: ${originalChat.length}`);
        
        // 检查是否已经有预览聊天ID
        const previewKey = groupId ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[pluginName].previewChats[previewKey];
        
        let isFirstPreview = false;
        
        if (existingPreviewChatId) {
            console.log(`${pluginName}: 发现现有预览聊天ID: ${existingPreviewChatId}`);
            
            // 切换到现有预览聊天
            if (groupId) {
                console.log(`${pluginName}: 正在切换到群组预览聊天...`);
                await openGroupChat(groupId, existingPreviewChatId);
            } else {
                console.log(`${pluginName}: 正在切换到角色预览聊天...`);
                await openCharacterChat(characterId, existingPreviewChatId);
            }
        } else {
            console.log(`${pluginName}: 未找到预览聊天ID，将创建新聊天`);
            isFirstPreview = true;
            
            // 创建新聊天并切换
            await doNewChat({ deleteCurrentChat: false });
            
            // 获取新创建的聊天ID
            const newContext = getContext();
            const newPreviewChatId = newContext.chatId;
            
            if (!newPreviewChatId) {
                console.error(`${pluginName}: 创建新聊天后无法获取聊天ID`);
                await callGenericPopup('创建预览聊天失败', POPUP_TYPE.ERROR);
                return;
            }
            
            console.log(`${pluginName}: 新聊天ID: ${newPreviewChatId}`);
            
            // 将新聊天ID保存为预览聊天
            extension_settings[pluginName].previewChats[previewKey] = newPreviewChatId;
            saveMetadataDebounced(); // 保存设置
        }
                // 延迟一下确保聊天加载完成
        const loadDelay = isFirstPreview ? 2000 : 1000;
        console.log(`${pluginName}: 等待 ${loadDelay}ms 确保聊天加载完成...`);
        await new Promise(resolve => setTimeout(resolve, loadDelay));
        
        // 清空当前聊天
        console.log(`${pluginName}: 清空当前聊天...`);
        clearChat();
        
        // 再次延迟，确保清空操作完成
        console.log(`${pluginName}: 等待300ms确保清空操作完成...`);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 准备要填充的收藏消息
        console.log(`${pluginName}: 正在准备收藏消息以填充预览聊天...`);
        const messagesToFill = [];
        
        // 遍历收藏项，收集对应的完整消息
        for (const favItem of chatMetadata.favorites) {
            const messageId = favItem.messageId;
            const messageIndex = parseInt(messageId, 10);
            
            if (!isNaN(messageIndex) && messageIndex < originalChat.length && originalChat[messageIndex]) {
                // 创建消息的深拷贝，避免引用原始对象
                const messageCopy = JSON.parse(JSON.stringify(originalChat[messageIndex]));
                
                // 记录原始的mesid
                messageCopy.original_mesid = messageIndex;

                if (!messageCopy.extra) {
                    messageCopy.extra = {};
                }
                if (!messageCopy.extra.swipes) {
                    messageCopy.extra.swipes = [];
                }
                
                messagesToFill.push({
                    message: messageCopy,
                    mesid: messageIndex
                });
                
                console.log(`${pluginName}: 已找到收藏消息 ID ${messageId}: ${originalChat[messageIndex].mes.substring(0, 30)}...`);
            } else {
                console.warn(`${pluginName}: 警告: 收藏消息 ID ${messageId} 不存在或已删除`);
            }
        }
        
        // 将messagesToFill按照mesid从小到大排序，确保消息按正确顺序添加
        messagesToFill.sort((a, b) => a.mesid - b.mesid);
        
        console.log(`${pluginName}: 找到 ${messagesToFill.length} 条有效收藏消息可以填充`);
        
        // 获取当前上下文
        const newContext = getContext();
        console.log(`${pluginName}: 获取新的上下文完成，准备填充消息`);
        
        // 填充消息到聊天
        let addedCount = 0;
        let hasRenamed = !isFirstPreview; // 如果不是首次预览，就不需要重命名
        
        for (const item of messagesToFill) {
            try {
                const message = item.message;
                const mesid = item.mesid;
                
                console.log(`${pluginName}: 正在添加消息 mesid=${mesid}: ${message.mes.substring(0, 30)}...`);
                
                // 使用forceId设置为原始的mesid
                await newContext.addOneMessage(message, { 
                    scroll: true,
                    forceId: mesid
                });
                
                // 首条消息添加成功后进行重命名（仅首次预览需要）
                if (addedCount === 0 && isFirstPreview && !hasRenamed) {
                    try {
                        // 等待一段时间后再尝试重命名
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log(`${pluginName}: 尝试重命名聊天为<预览聊天>...`);
                        await renameChat("<预览聊天>");
                        hasRenamed = true;
                        console.log(`${pluginName}: 聊天已重命名为<预览聊天>`);
                    } catch (renameError) {
                        console.warn(`${pluginName}: 重命名聊天失败，将继续填充消息:`, renameError);
                        // 即使重命名失败也继续填充
                    }
                }
                
                // 在消息之间添加短暂延迟，确保顺序正确
                await new Promise(resolve => setTimeout(resolve, 100));
                
                console.log(`${pluginName}: 消息 mesid=${mesid} 添加成功`);
                addedCount++;
                
            } catch (error) {
                console.error(`${pluginName}: 添加消息时出错:`, error);
                // 发生错误时暂停一下再继续
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // 显示成功消息
        toastr.success(`已在预览聊天中显示 ${addedCount} 条收藏消息`);
        
    } catch (error) {
        console.error(`${pluginName}: 执行预览过程中发生错误:`, error);
        toastr.error('创建预览聊天或填充消息时出错，请查看控制台');
    }
}

/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // 注入CSS样式
        const styleElement = document.createElement('style');
        styleElement.innerHTML = `
            /* Favorites popup styles */
            .favorites-popup-content {
                padding: 10px;
                max-height: 70vh;
                overflow-y: auto;
            }

            .favorites-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 10px;
            }

            .favorites-header h3 {
                text-align: center;
                margin: 0;
            }

            .favorites-divider {
                height: 1px;
                background-color: #ccc;
                margin: 10px 0;
            }

            .favorites-list {
                margin: 10px 0;
            }

            .favorites-empty {
                text-align: center;
                color: #888;
                padding: 20px;
            }

            .favorite-item {
                border: 1px solid #444;
                border-radius: 8px;
                margin-bottom: 10px;
                padding: 10px;
                background-color: rgba(0, 0, 0, 0.2);
                position: relative;
            }

            .fav-meta {
                font-size: 0.8em;
                color: #aaa;
                margin-bottom: 5px;
            }

            .fav-note {
                background-color: rgba(255, 255, 0, 0.1);
                padding: 5px;
                border-left: 3px solid #ffcc00;
                margin-bottom: 5px;
                font-style: italic;
            }

            .fav-preview {
                margin-bottom: 5px;
                line-height: 1.4;
                max-height: 200px;
                overflow-y: auto;
                word-wrap: break-word;
                white-space: pre-wrap;
            }

            .fav-preview.deleted {
                color: #ff3a3a;
                font-style: italic;
            }

            .fav-actions {
                text-align: right;
            }

            .fav-actions i {
                cursor: pointer;
                margin-left: 10px;
                padding: 5px;
                border-radius: 50%;
            }

            .fav-actions i:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }

            .fa-pencil {
                color: #3a87ff;
            }

            .fa-trash {
                color: #ff3a3a;
            }

            /* Star icon styles */
            .favorite-toggle-icon {
                cursor: pointer;
            }

            .favorite-toggle-icon i.fa-regular {
                color: #999;
            }

            .favorite-toggle-icon i.fa-solid {
                color: #ffcc00;
            }
            
            /* Pagination styles */
            .favorites-pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-top: 10px;
                gap: 10px;
            }
            
            .favorites-footer {
                display: flex;
                justify-content: space-between;
                margin-top: 15px;
            }
        `;
        document.head.appendChild(styleElement);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);

            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings to extension settings
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#translation_container').append(settingsHtml);
            console.log(`${pluginName}: 已将设置 UI 添加到 #translation_container`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Set up event delegation for favorite toggle icon
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for current chat on load
        ensureFavoritesArrayExists(); // 尝试初始化

        // Initial UI setup
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();

        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: 聊天已更改，更新收藏图标...`);
            ensureFavoritesArrayExists(); // 确保新聊天的数组存在
            setTimeout(() => {
                addFavoriteIconsToMessages(); // 为新消息添加图标结构
                refreshFavoriteIconsInView(); // 根据新加载的数据更新所有图标状态
            }, 100); // 延迟以等待 DOM 更新
        });

        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIdString) => {
            // deletedMessageId 通常是数字索引，需要转换为字符串以匹配存储的 messageId
            const deletedMessageId = String(deletedMessageIdString);
            console.log(`${pluginName}: 检测到消息删除事件, ID (可能为索引): ${deletedMessageId}`);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;

            // 查找是否有收藏项引用了这个 messageId (mesid 字符串)
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);

            if (favIndex !== -1) {
                console.log(`${pluginName}: 消息 ${deletedMessageId} 被删除，移除对应的收藏项`);
                chatMetadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced(); // 保存更改

                // 更新弹窗（如果打开）
                if (favoritesPopup && favoritesPopup.isVisible()) {
                    updateFavoritesPopup();
                }
            } else {
                 console.log(`${pluginName}: 未找到引用消息 ${deletedMessageId} 的收藏项`);
            }
        });

        // Listener for when new messages appear (sent or received)
        const handleNewMessage = () => {
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // 确保新消息有图标
                 // refreshFavoriteIconsInView(); // 通常不需要完全刷新，新图标默认是未收藏状态
             }, 100); // 延迟等待 DOM 更新
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        eventSource.on(event_types.MESSAGE_UPDATED, () => { // 当消息更新时，刷新其状态
             setTimeout(() => refreshFavoriteIconsInView(), 100);
        });


        // Listener for when more messages are loaded (scrolling up)
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: 加载了更多消息，更新图标...`);
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // 为新加载的消息添加图标结构
                 refreshFavoriteIconsInView(); // 更新所有可见图标的状态
             }, 100);
        });

        // MutationObserver remains a good fallback for dynamic changes
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        // 检查添加的是否是消息元素或包含消息元素
                        if (node.nodeType === 1) {
                            if ($(node).hasClass('mes') || $(node).find('.mes').length > 0) {
                                needsIconAddition = true;
                            }
                        }
                    });
                }
            }
            if (needsIconAddition) {
                 // 使用 debounce 或 throttle 避免过于频繁的调用
                 setTimeout(() => addFavoriteIconsToMessages(), 150); // 稍长延迟
            }
        });

        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true,
                subtree: true
            });
             console.log(`${pluginName}: MutationObserver 已启动，监视 #chat 的变化`);
        } else {
             console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`);
        }


        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
