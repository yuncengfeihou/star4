// public/extensions/third-party/favorites-plugin/index.js

// --- 现有 Imports ---
import {
    eventSource,
    event_types,
    messageFormatting,
    // 假设这些全局函数/变量在环境中可用，如果不可用需要寻找替代方案
    is_send_press,
    isChatSaving,
    this_chid,
    clearChat,
    doNewChat,
    saveSettingsDebounced,
    renameChat,
    // 可能需要 chatGptApi.getChatList() 或类似方法获取聊天列表来检查预览聊天是否存在
} from '../../../../script.js';
import { selected_group, is_group_generating, openGroupChat } from '../../../group-chats.js'; // 假设 openGroupChat 在这里
import { openCharacterChat } from '../../../../script.js'; // 假设 openCharacterChat 在这里

import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced, // 用于保存 chatMetadata.favorites
} from '../../../extensions.js';

import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

import {
    uuidv4,
    // timestampToMoment, // 保持但未使用
} from '../../../utils.js';

// Define plugin folder name
const pluginName = 'star4'; // 保持一致

// Initialize plugin settings (全局，用于存储 previewChats)
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}
// 确保 previewChats 映射存在于插件设置中
if (!extension_settings[pluginName].previewChats) {
    extension_settings[pluginName].previewChats = {};
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
const itemsPerPage = 5; // 保持分页逻辑

// --- 现有函数 (ensureFavoritesArrayExists, addFavorite, removeFavoriteById, removeFavoriteByMessageId, updateFavoriteNote, handleFavoriteToggle, addFavoriteIconsToMessages, refreshFavoriteIconsInView, renderFavoriteItem) ---
// ... (这些函数保持不变，因为它们操作 chatMetadata.favorites) ...

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

    // 检查是否已收藏 (基于 messageId)
    const alreadyExists = chatMetadata.favorites.some(fav => fav.messageId === messageInfo.messageId);
    if (alreadyExists) {
        console.log(`${pluginName}: Message with ID ${messageInfo.messageId} is already favorited.`);
        return; // 如果已存在，则不添加
    }

    // 创建收藏项
    const item = {
        id: uuidv4(), // 使用 UUID
        messageId: messageInfo.messageId, // 存储 mesid 字符串
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };

    // 确保 favorites 是数组
    if (!Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: addFavorite - chatMetadata.favorites 不是数组，无法添加！`);
        return;
    }

    console.log(`${pluginName}: 添加前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    chatMetadata.favorites.push(item); // 添加到元数据
    console.log(`${pluginName}: 添加后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

    console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced(); // 保存元数据

    console.log(`${pluginName}: Added favorite:`, item);

    // Update the popup if it's open
    if (favoritesPopup && favoritesPopup.isVisible()) {
        updateFavoritesPopup(); // 更新弹窗内容，包括可能的总数变化
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

    const initialLength = chatMetadata.favorites.length;
    // 使用 filter 创建新数组，移除匹配的项
    chatMetadata.favorites = chatMetadata.favorites.filter(fav => fav.id !== favoriteId);
    const removed = chatMetadata.favorites.length < initialLength;

    if (removed) {
        console.log(`${pluginName}: 删除后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存删除...`);
        saveMetadataDebounced(); // 调用导入的保存函数
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        // Update the popup if it's open
        if (favoritesPopup && favoritesPopup.isVisible()) {
            updateFavoritesPopup(); // 更新弹窗内容
        }
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

    // 根据 messageId (mesid 字符串) 查找收藏项
    const favItem = chatMetadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
        // 如果找到，调用按 favoriteId 删除的函数
        return removeFavoriteById(favItem.id); // removeFavoriteById 会处理保存和弹窗更新
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
         // Update the popup if it's open to reflect the change
        if (favoritesPopup && favoritesPopup.isVisible()) {
            updateFavoritesPopup();
        }
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

    // 获取 mesid 属性值 (字符串)
    const messageIdString = messageElement.attr('mesid');
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：未找到 mesid 属性`);
        return;
    }

    // 尝试将 mesid 转换为数字索引，用于查找消息对象
    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：mesid 解析为 NaN: ${messageIdString}`);
        // 在某些情况下，mesid 可能不是纯数字，或者查找方式应直接基于 mesid 字符串
        // 如果环境保证 mesid 严格对应 chat 数组索引，则此检查有效
        // 否则，需要调整查找 message 的逻辑
    }

    console.log(`${pluginName}: handleFavoriteToggle - 获取 context 和消息对象 (mesid: ${messageIdString})`);
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

    // 从 context.chat 中查找对应的消息对象
    // 主要方式：通过 mesid 字符串匹配。这更健壮，因为索引可能变化。
    // const message = context.chat.find(msg => $(msg).attr('mesid') === messageIdString); // jQuery 方式，可能有性能问题
    // 备选方式：如果 mesid 确实是可靠的索引
    const message = (context.chat && !isNaN(messageIndex) && context.chat[messageIndex]) ? context.chat[messageIndex] : null;
    // 添加验证，确保找到的消息的 mesid 确实匹配 (如果消息对象有 mesid 属性或可以通过 DOM 获取)
    // let foundMessage = null;
    // if (!isNaN(messageIndex) && context.chat[messageIndex]) {
    //     const potentialMsgElement = $(context.chat[messageIndex]); // Assuming chat stores DOM elements or objects convertible to jQuery
    //     if (potentialMsgElement.attr('mesid') === messageIdString) {
    //         foundMessage = context.chat[messageIndex];
    //     }
    // }
    // // Fallback or primary find by iterating if index is unreliable
    // if (!foundMessage) {
    //     // This depends heavily on what `context.chat` actually contains (DOM elements? Objects?)
    //     // If it contains message data objects with a `mesid` property:
    //     // foundMessage = context.chat.find(msgData => String(msgData.mesid) === messageIdString);
    //     // If it contains DOM elements (less likely for raw data):
    //     // This is complex. Let's assume the index lookup is the intended way or context.chat contains findable objects.
    // }

    // 简化：暂时信任 mesid 转为索引的查找方式，如果 messageIndex 有效
    if (!message) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在索引 ${messageIndex} (来自 mesid ${messageIdString}) 未找到消息对象`);
        // 可能需要实现更可靠的基于 mesid 字符串的查找
        return;
    }
     // 进一步验证找到的消息是否正确 (如果消息对象有 name 和 is_user 属性)
    if (typeof message.name === 'undefined' || typeof message.is_user === 'undefined') {
        console.warn(`${pluginName}: handleFavoriteToggle - 找到的消息对象似乎不完整 (缺少 name 或 is_user)，mesid: ${messageIdString}`);
        // 决定是否继续，可能数据结构不符合预期
    }


    console.log(`${pluginName}: handleFavoriteToggle - 成功获取消息对象:`, message);

    const iconElement = target.find('i');
    if (!iconElement || !iconElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在 .favorite-toggle-icon 内未找到 i 元素`);
        return;
    }
    // 检查 chatMetadata 中是否存在此 messageId 的收藏
    const chatMetadata = ensureFavoritesArrayExists();
    const isCurrentlyFavorited = chatMetadata && chatMetadata.favorites.some(fav => fav.messageId === messageIdString);

    console.log(`${pluginName}: handleFavoriteToggle - 当前状态 (isFavorited): ${isCurrentlyFavorited}`);

    if (isCurrentlyFavorited) {
        // --- 取消收藏 ---
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 removeFavoriteByMessageId`);
        console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 参数: ${messageIdString}`);
        const removed = removeFavoriteByMessageId(messageIdString); // 这个函数会处理保存和弹窗更新
        if (removed) {
            // 更新 UI
            iconElement.removeClass('fa-solid').addClass('fa-regular');
            console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：取消收藏 (regular icon)`);
        } else {
             console.error(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 调用失败，UI 未变更`);
        }
    } else {
        // --- 添加收藏 ---
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 addFavorite`);
        // 确保 message 对象包含所需信息
         if (typeof message.name === 'undefined' || typeof message.is_user === 'undefined') {
             console.error(`${pluginName}: handleFavoriteToggle - 无法添加收藏，消息对象缺少 name 或 is_user 属性。`);
             return;
         }
        const messageInfo = {
            messageId: messageIdString, // 存储 mesid 字符串
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
        };
        console.log(`${pluginName}: handleFavoriteToggle - addFavorite 参数:`, messageInfo);
        try {
            addFavorite(messageInfo); // 这个函数会处理保存和弹窗更新
             // 更新 UI
            iconElement.removeClass('fa-regular').addClass('fa-solid');
            console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：收藏 (solid icon)`);
            console.log(`${pluginName}: handleFavoriteToggle - addFavorite 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 addFavorite 时出错:`, e);
             // 出错时不应该更新 UI
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
        // 排除系统消息等没有 extraMesButtons 的情况
        if (messageElement.hasClass('system') || messageElement.hasClass('info') || messageElement.hasClass('source')) {
            return;
        }
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
            // console.log(`${pluginName}: Added favorite icon to message ${messageElement.attr('mesid')}`);
        } else if (extraButtonsContainer.length === 0) {
             // 如果没有 extraMesButtons 容器，可能需要创建它？或者忽略这种消息？
             // console.warn(`${pluginName}: Message ${messageElement.attr('mesid')} lacks .extraMesButtons container.`);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    // 如果无法获取元数据，或者元数据中没有 favorites 数组，则将所有图标设为空心
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取有效的 chatMetadata 或 favorites 数组，将所有图标设为未收藏状态`);
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }

    // 确保所有消息都有图标结构 (以防万一)
    addFavoriteIconsToMessages();

    // 更新图标状态
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid'); // 获取 mesid 字符串

        if (messageId) {
            // 使用 chatMetadata.favorites 进行检查，匹配 messageId 字符串
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
    console.log(`${pluginName}: Favorite icons refreshed.`);
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination tracking, not data fetching)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    if (!favItem) return '';

    const context = getContext();
    let message = null;
    let messagePreviewHtml = '';
    let deletedClass = 'deleted'; // Assume deleted initially

    // 查找消息：优先根据 favItem.messageId (mesid 字符串) 在 context.chat 中查找
    if (context && context.chat && favItem.messageId) {
        // 假设 context.chat 存储的是可以直接处理的消息对象
        // 这个查找逻辑需要根据 context.chat 的实际结构调整
        // 方案一：如果 chat 存储的是带 mesid 属性的对象
        // message = context.chat.find(msg => String(msg.mesid) === favItem.messageId);

        // 方案二：如果 chat 存储的是需要转为 jQuery 对象才能获取 mesid 的元素
        // message = context.chat.find(msgElement => $(msgElement).attr('mesid') === favItem.messageId);

        // 方案三：如果 favItem.messageId 恰好是可靠的数组索引 (如旧版或特定配置)
        const messageIndex = parseInt(favItem.messageId, 10);
        if (!isNaN(messageIndex) && context.chat[messageIndex]) {
             // 验证索引处的元素 mesid 是否匹配
             const potentialMsgElement = $(context.chat[messageIndex]); // 假设可以转 jQuery
             // 确保 potentialMsgElement 是有效的 jQuery 对象并且有 attr 方法
             if (potentialMsgElement && typeof potentialMsgElement.attr === 'function' && potentialMsgElement.attr('mesid') === favItem.messageId) {
                 message = context.chat[messageIndex];
             }
        }

        // 如果通过索引找不到或不匹配，尝试更可靠的查找（需要知道 chat 结构）
        // ... 实现查找逻辑 ...
        // 简化：暂时依赖索引查找，如果失败则认为是已删除
    }


    if (message && message.mes) { // 确保找到的消息对象有效且有 mes 属性
        deletedClass = ''; // 消息存在
        let previewText = message.mes; // 获取完整的消息内容

        try {
             // 使用 messageFormatting 进行渲染
             messagePreviewHtml = messageFormatting(previewText, favItem.sender, false,
                                            favItem.role === 'user', null, {}, false);
        } catch (e) {
             console.error(`${pluginName}: Error formatting message preview for mesid ${favItem.messageId}:`, e);
             // Fallback: 使用原始文本，进行基本的 HTML 转义防止 XSS
             messagePreviewHtml = $('<div>').text(previewText).html(); // Basic escaping
        }
    } else {
        messagePreviewHtml = '[消息内容不可用或已删除]';
        deletedClass = 'deleted';
    }

    // 生成备注的 HTML，只有在有备注时才显示
    const noteHtml = favItem.note ? `<div class="fav-note">备注：${$('<div>').text(favItem.note).html()}</div>` : '';

    // 返回最终的 HTML
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${$('<div>').text(favItem.sender).html()} (${favItem.role})</div>
            ${noteHtml}
            <div class="fav-preview ${deletedClass}">${messagePreviewHtml}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data, including pagination and the new preview button
 */
function updateFavoritesPopup() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!favoritesPopup || !chatMetadata) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready or chatMetadata missing.`);
        return;
    }

    if (!favoritesPopup.content) {
        console.error(`${pluginName}: updateFavoritesPopup - favoritesPopup.content is null or undefined! Cannot update.`);
        return;
    }
    console.log(`${pluginName}: updateFavoritesPopup - favoritesPopup.content element:`, favoritesPopup.content);

    const context = getContext();
    // 尝试获取当前聊天名称（角色名或群组名）
    let chatName = '未知聊天';
    if (context) {
        if (context.characterId && context.name2) {
             chatName = context.name2;
        } else if (context.groupId && context.groups) {
             const group = context.groups.find(g => g.id === context.groupId);
             chatName = group ? `群组: ${group.name}` : `群组: ${context.groupId}`;
        } else if (context.chatId) {
             chatName = `聊天: ${context.chatId.substring(0, 8)}...`; // 备用名称
        }
    }

    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;
    // 按 messageId (转换为数字) 倒序排序
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => parseInt(b.messageId, 10) - parseInt(a.messageId, 10)) : [];

    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${$('<div>').text(chatName).html()} - ${totalFavorites} 条收藏</h3>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。<br>点击消息右下角的 <i class="fa-regular fa-star"></i> 图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            contentHtml += renderFavoriteItem(favItem, startIndex + index); // 传递 favItem 和全局索引
        });

        if (totalPages > 1) {
            contentHtml += `<div class="favorites-pagination">`;
            contentHtml += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>&lt; 上一页</button>`;
            contentHtml += `<span> 第 ${currentPage} / ${totalPages} 页 </span>`;
            contentHtml += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页 &gt;</button>`;
            contentHtml += `</div>`;
        }
    }

    contentHtml += `
            </div>
            <div class="favorites-footer">
                <button class="menu_button preview-favorites" title="在新聊天中预览所有收藏的消息"${totalFavorites === 0 ? ' disabled' : ''}>预览收藏</button>
                <button class="menu_button clear-invalid" title="移除引用已删除消息的收藏项"${totalFavorites === 0 ? ' disabled' : ''}>清理无效</button>
                <button class="menu_button close-popup">关闭</button>
            </div>
        </div>
    `;

    try {
        favoritesPopup.content.innerHTML = contentHtml; // 更新弹窗内容
        console.log(`${pluginName}: Popup content updated.`);
    } catch (error) {
         console.error(`${pluginName}: Error setting popup innerHTML:`, error);
    }
}


/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>', // Initial loading state
                POPUP_TYPE.TEXT, // Type doesn't strictly matter here as content is replaced
                '', // No initial text body needed
                {
                    title: '收藏管理', // Popup title
                    wide: true,      // Make the popup wider
                    okButton: false, // Hide default OK button
                    cancelButton: false, // Hide default Cancel button
                    allowVerticalScrolling: false, // Content div will handle scrolling
                    buttons: [] // Remove default buttons, we add our own
                }
            );

            console.log(`${pluginName}: Popup instance created successfully.`);

            // Attach event listener to the popup's content container using event delegation
            $(favoritesPopup.content).on('click', async function(event) { // Mark as async for await calls
                const target = $(event.target);

                // Handle pagination Previous
                if (target.hasClass('pagination-prev') && !target.is(':disabled')) {
                    if (currentPage > 1) {
                        currentPage--;
                        updateFavoritesPopup();
                    }
                }
                // Handle pagination Next
                else if (target.hasClass('pagination-next') && !target.is(':disabled')) {
                    const chatMetadata = ensureFavoritesArrayExists();
                    const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                    if (currentPage < totalPages) {
                        currentPage++;
                        updateFavoritesPopup();
                    }
                }
                // Handle Close button
                else if (target.hasClass('close-popup')) {
                    favoritesPopup.hide();
                }
                // Handle Clear Invalid button
                else if (target.hasClass('clear-invalid') && !target.is(':disabled')) {
                    await handleClearInvalidFavorites(); // Await the async function
                }
                // Handle Preview Favorites button <<< NEW
                else if (target.hasClass('preview-favorites') && !target.is(':disabled')) {
                    await handlePreviewFavorites(); // Await the async function
                }
                // Handle Edit Note (pencil icon)
                else if (target.hasClass('fa-pencil')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         await handleEditNote(favId); // Await the async function
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                // Handle Delete Favorite (trash icon)
                else if (target.hasClass('fa-trash')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                        const favId = favItem.data('fav-id');
                        const msgId = favItem.data('msg-id'); // Get messageId (mesid string)
                        await handleDeleteFavoriteFromPopup(favId, String(msgId)); // Ensure msgId is string, await async
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null; // Reset on failure
            callGenericPopup("无法创建收藏弹窗，请检查控制台。", POPUP_TYPE.ERROR);
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
    }

    currentPage = 1; // Reset to first page every time popup is opened
    updateFavoritesPopup(); // Update content (this sets the initial view)

    if (favoritesPopup) {
        try {
            favoritesPopup.show(); // Show the popup
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
             callGenericPopup("无法显示收藏弹窗，请检查控制台。", POPUP_TYPE.ERROR);
             // Optionally reset popup so it gets recreated next time
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
    // Ensure messageId is treated as a string
    const msgIdStr = String(messageId);
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.YES) {
        if (removeFavoriteById(favId)) { // This function now handles saving and updating popup
            // Update the main chat interface icon for the corresponding message
            // Need jQuery selector that correctly finds element by attribute `mesid="<value>"`
            const messageElement = $(`#chat .mes[mesid="${msgIdStr}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                    console.log(`${pluginName}: Updated icon for deleted favorite (mesid: ${msgIdStr})`);
                }
            } else {
                 console.warn(`${pluginName}: Could not find message element with mesid="${msgIdStr}" to update icon after deletion.`);
            }
             await callGenericPopup('收藏已删除。', POPUP_TYPE.TEXT); // Inform user
        } else {
             await callGenericPopup('删除收藏失败。', POPUP_TYPE.ERROR); // Inform user of failure
        }
    }
}

/**
 * Handles editing the note for a favorite
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: handleEditNote - Cannot get chatMetadata or favorites.`);
        await callGenericPopup('无法加载收藏信息以编辑备注。', POPUP_TYPE.ERROR);
        return;
    }

    const favorite = chatMetadata.favorites.find(fav => fav.id === favId);
    if (!favorite) {
        console.error(`${pluginName}: handleEditNote - Favorite item not found for ID: ${favId}`);
        await callGenericPopup('找不到要编辑的收藏项。', POPUP_TYPE.ERROR);
        return;
    }

    // Use callGenericPopup for input
    const result = await callGenericPopup(
        '为这条收藏添加或修改备注:', // Prompt text
        POPUP_TYPE.INPUT,         // Popup type
        favorite.note || '',      // Default value (current note or empty string)
        {
            rows: 3,              // Make textarea slightly larger if possible
            placeholder: '输入备注...' // Placeholder text
        }
    );

    // Check if the user confirmed (result is the input text, or null/undefined if cancelled)
    // Allow empty string as a valid note
    if (result !== undefined && result !== null && result !== POPUP_RESULT.CANCELLED) { // Check against cancellation results
        updateFavoriteNote(favId, String(result)); // Update note (this handles saving & popup update)
        // updateFavoritesPopup() is called inside updateFavoriteNote now
        await callGenericPopup('备注已更新。', POPUP_TYPE.TEXT);
    } else {
         console.log(`${pluginName}: handleEditNote - Note editing cancelled.`);
    }
}


/**
 * Clears invalid favorites (those referencing deleted messages)
 * Adjusted to use mesid string matching.
 */
async function handleClearInvalidFavorites() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        await callGenericPopup('当前没有收藏项可清理。', POPUP_TYPE.INFO);
        return;
    }

    const context = getContext();
    if (!context || !context.chat) {
         await callGenericPopup('无法获取当前聊天信息以验证收藏。', POPUP_TYPE.ERROR);
         return;
    }

    const originalFavorites = chatMetadata.favorites;
    const validFavorites = [];
    const invalidFavoriteIds = [];

    console.log(`${pluginName}: Checking ${originalFavorites.length} favorites for validity...`);
    originalFavorites.forEach(fav => {
        const mesIdStr = fav.messageId; // The mesid string
        let messageExists = false;

        // Try to find message in context.chat based on mesid string
        // This requires knowing the structure of context.chat elements
        // Assuming chat contains objects with a 'mesid' property:
        // messageExists = context.chat.some(msg => String(msg.mesid) === mesIdStr);

        // Assuming chat contains DOM elements needing jQuery:
        // messageExists = context.chat.some(msgElement => $(msgElement).attr('mesid') === mesIdStr);

        // Let's try the index method first as a primary check, then maybe a fallback
        const messageIndex = parseInt(mesIdStr, 10);
        if (!isNaN(messageIndex) && context.chat[messageIndex]) {
             const potentialMsgElement = $(context.chat[messageIndex]); // Assume conversion works
             if (potentialMsgElement && typeof potentialMsgElement.attr === 'function' && potentialMsgElement.attr('mesid') === mesIdStr) {
                 messageExists = true;
             }
        }

        // If index didn't work or didn't match, could add a more robust find here if needed

        if (messageExists) {
            validFavorites.push(fav);
        } else {
            console.log(`${pluginName}: Found invalid favorite: ID ${fav.id}, referencing mesid ${mesIdStr}`);
            invalidFavoriteIds.push(fav.id);
        }
    });

    const invalidCount = invalidFavoriteIds.length;
    if (invalidCount === 0) {
        await callGenericPopup('没有找到无效的收藏项。所有收藏都指向当前聊天中的有效消息。', POPUP_TYPE.INFO);
        return;
    }

    const confirmResult = await callGenericPopup(
        `发现 ${invalidCount} 条收藏指向的消息似乎已不存在于当前聊天记录中。确定要删除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM
    );

    if (confirmResult === POPUP_RESULT.YES) {
        // Directly assign the filtered list
        chatMetadata.favorites = validFavorites;
        saveMetadataDebounced(); // Save the change to chatMetadata

        console.log(`${pluginName}: Cleared ${invalidCount} invalid favorites.`);
        await callGenericPopup(`已成功清理 ${invalidCount} 条无效收藏。`, POPUP_TYPE.SUCCESS);

        // Reset pagination and update popup
        currentPage = 1;
        updateFavoritesPopup();
    } else {
         console.log(`${pluginName}: Clearing invalid favorites cancelled by user.`);
    }
}

// --- NEW FUNCTION: Handle Preview Favorites ---
/**
 * Handles the logic for the "Preview Favorites" button.
 * Creates or switches to a dedicated preview chat and populates it with favorited messages.
 */
async function handlePreviewFavorites() {
    console.log(`${pluginName}: Preview Favorites button clicked.`);

    try {
        // 1. Get Current Context and Check Prerequisites
        const originalContext = getContext();
        if (!originalContext) {
            await callGenericPopup("无法获取当前聊天上下文。", POPUP_TYPE.ERROR);
            return;
        }

        const { chatId: originalChatId, characterId, groupId, name2: characterName, groups } = originalContext;
        const currentChat = originalContext.chat; // Get the original chat messages array

        // Check if a character or group is selected
        const isCharacter = !!characterId;
        const isGroup = !!groupId;
        if (!isCharacter && !isGroup) {
            console.error(`${pluginName}: Preview error - No character or group selected.`);
            await callGenericPopup("请先选择一个角色或群组聊天才能创建预览。", POPUP_TYPE.ERROR);
            return;
        }

        // Check for ongoing operations (using assumed global variables/functions)
        if (typeof is_send_press !== 'undefined' && is_send_press) {
             await callGenericPopup("正在生成回复，请稍后再试预览。", POPUP_TYPE.WARNING); return;
        }
        if (typeof is_group_generating !== 'undefined' && is_group_generating) {
             await callGenericPopup("群组正在生成回复，请稍后再试预览。", POPUP_TYPE.WARNING); return;
        }
         if (typeof isChatSaving !== 'undefined' && isChatSaving) {
             await callGenericPopup("聊天正在保存，请稍后再试预览。", POPUP_TYPE.WARNING); return;
        }

        // 2. Get Favorite Items from Metadata
        const chatMetadata = ensureFavoritesArrayExists(); // Get metadata for the *original* chat
        if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
            await callGenericPopup("当前聊天没有收藏的消息可供预览。", POPUP_TYPE.INFO);
            return;
        }
        const favoriteItems = chatMetadata.favorites;
        console.log(`${pluginName}: Found ${favoriteItems.length} favorite items in metadata.`);

        // 3. Determine Preview Chat Key and Check for Existing Preview Chat
        const previewKey = isGroup ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[pluginName].previewChats[previewKey];
        let targetChatId = existingPreviewChatId;
        let isFirstPreview = false;

        if (targetChatId) {
            console.log(`${pluginName}: Found existing preview chat ID for ${previewKey}: ${targetChatId}`);
            // Optional: Verify if the chat still exists (e.g., using chatGptApi.getChatList())
            // This adds complexity, skipping for now. Assume ID is valid if present.
            try {
                 if (isGroup) {
                     console.log(`${pluginName}: Switching to existing group preview chat: ${targetChatId}`);
                     await openGroupChat(groupId, targetChatId); // Assumes this switches context
                 } else {
                     console.log(`${pluginName}: Switching to existing character preview chat: ${targetChatId}`);
                     await openCharacterChat(characterId, targetChatId); // Assumes this switches context
                 }
            } catch (switchError) {
                 console.error(`${pluginName}: Error switching to existing preview chat ${targetChatId}. Creating a new one.`, switchError);
                 await callGenericPopup(`切换到预览聊天失败，将创建新预览。\n错误: ${switchError.message}`, POPUP_TYPE.WARNING);
                 targetChatId = null; // Force creation of a new chat
                 delete extension_settings[pluginName].previewChats[previewKey]; // Remove bad ID
                 // Requires saveSettingsDebounced to be called later
            }

        }

        if (!targetChatId) {
            console.log(`${pluginName}: No existing preview chat found for ${previewKey}, creating new chat...`);
            isFirstPreview = true;
            try {
                // Create a new chat session. Assume doNewChat switches context automatically.
                // Pass false to avoid deleting the current (original) chat.
                await doNewChat({ deleteCurrentChat: false });

                // Get the context of the newly created chat
                const newContext = getContext();
                if (!newContext || !newContext.chatId) {
                    throw new Error("Failed to get context or chatId for the newly created chat.");
                }
                targetChatId = newContext.chatId;
                console.log(`${pluginName}: New preview chat created with ID: ${targetChatId}`);

                // Store the new preview chat ID in the plugin's global settings
                extension_settings[pluginName].previewChats[previewKey] = targetChatId;
                // Save the updated global plugin settings
                if (typeof saveSettingsDebounced === 'function') {
                    saveSettingsDebounced(); // Call the imported global save function
                    console.log(`${pluginName}: Saved new preview chat mapping to extension_settings.`);
                } else {
                     console.warn(`${pluginName}: Global 'saveSettingsDebounced' function not available. Preview chat mapping might not persist.`);
                     // Consider alternative saving mechanism or inform user.
                }

            } catch (creationError) {
                console.error(`${pluginName}: Error creating new preview chat:`, creationError);
                await callGenericPopup(`创建预览聊天失败: ${creationError.message}`, POPUP_TYPE.ERROR);
                return; // Stop the process if chat creation fails
            }
        }

        // 4. Prepare and Populate the Preview Chat

        // Short delay to allow UI/context to potentially update after switching/creating chat
        console.log(`${pluginName}: Waiting briefly before populating chat...`);
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

        // Get the context *again* to ensure we are targeting the correct (preview) chat
        const previewContext = getContext();
        if (!previewContext || previewContext.chatId !== targetChatId) {
             console.error(`${pluginName}: Context switch failed or context invalid after delay. Target: ${targetChatId}, Current: ${previewContext?.chatId}`);
             await callGenericPopup("无法切换到预览聊天或上下文无效。", POPUP_TYPE.ERROR);
             return;
        }

        // Clear the target preview chat before populating
        console.log(`${pluginName}: Clearing preview chat (ID: ${targetChatId})...`);
        try {
            // Make sure clearChat operates on the *current* context (which should be the preview chat now)
            await clearChat(); // Assuming clearChat clears the chat in the current context
        } catch (clearError) {
             console.error(`${pluginName}: Error clearing preview chat:`, clearError);
             await callGenericPopup(`清空预览聊天时出错: ${clearError.message}`, POPUP_TYPE.ERROR);
             return;
        }

         // Another short delay after clearing
        await new Promise(resolve => setTimeout(resolve, 300));

        console.log(`${pluginName}: Preparing messages to fill the preview chat...`);
        const messagesToFill = [];

        // Iterate through favorites and find corresponding messages in the *original* chat
        for (const favItem of favoriteItems) {
            const mesIdString = favItem.messageId;
            // Find the message in the original chat data (currentChat)
            let originalMessage = null;
            const messageIndex = parseInt(mesIdString, 10);

            // Primary find method: Use index if valid and mesid matches
             if (!isNaN(messageIndex) && currentChat[messageIndex]) {
                 const potentialMsgElement = $(currentChat[messageIndex]); // Assume conversion works
                 if (potentialMsgElement && typeof potentialMsgElement.attr === 'function' && potentialMsgElement.attr('mesid') === mesIdString) {
                     originalMessage = currentChat[messageIndex];
                 }
             }

            // Fallback find method (if needed, depends on chat structure)
            // if (!originalMessage) { ... find by iterating ... }

            if (originalMessage) {
                 // Important: Create a DEEP COPY of the message object
                 // to avoid modifying the original chat data.
                 try {
                    const messageCopy = JSON.parse(JSON.stringify(originalMessage));
                    // Add the original mesid string for sorting purposes
                    messageCopy.original_mesid_for_sort = mesIdString;
                    messagesToFill.push(messageCopy);
                    // console.log(`${pluginName}: Found original message for fav mesid ${mesIdString}`);
                 } catch(copyError) {
                      console.error(`${pluginName}: Error deep copying message for mesid ${mesIdString}:`, copyError);
                 }

            } else {
                console.warn(`${pluginName}: Could not find original message in original chat for favorite with mesid ${mesIdString}. Skipping.`);
            }
        }

        // Sort messages based on their original mesid (converted to number)
        messagesToFill.sort((a, b) => parseInt(a.original_mesid_for_sort, 10) - parseInt(b.original_mesid_for_sort, 10));

        console.log(`${pluginName}: Found ${messagesToFill.length} valid messages to add to preview chat.`);

        if (messagesToFill.length === 0) {
             await callGenericPopup("没有找到有效的原始消息来填充预览聊天。", POPUP_TYPE.WARNING);
             // Rename if first preview, even if empty? Or only if messages added?
             if (isFirstPreview) {
                 try {
                     console.log(`${pluginName}: Renaming empty first preview chat to '<预览聊天>'...`);
                     await renameChat("<预览聊天>"); // Assume renameChat uses current context
                 } catch (renameError) {
                     console.warn(`${pluginName}: Failed to rename empty preview chat:`, renameError);
                 }
             }
             return; // Nothing more to do
        }


        // Add messages to the preview chat one by one
        let addedCount = 0;
        let hasRenamed = !isFirstPreview; // Don't rename if not the first time

        console.log(`${pluginName}: Starting to add messages to preview chat...`);
        for (const message of messagesToFill) {
            try {
                // Use the addOneMessage method from the preview chat's context
                // We are NOT using forceId here for simplicity and robustness.
                // The order comes from the sorting we did earlier.
                console.log(`${pluginName}: Adding message originally mesid=${message.original_mesid_for_sort}`);
                await previewContext.addOneMessage(message, { scroll: true }); // Add the deep copied message

                addedCount++;

                 // Rename the chat after the first message is successfully added (only if it's the first preview)
                if (addedCount === 1 && isFirstPreview && !hasRenamed) {
                     // Delay slightly before renaming
                     await new Promise(resolve => setTimeout(resolve, 500));
                    try {
                        console.log(`${pluginName}: Renaming first preview chat to '<预览聊天>'...`);
                        await renameChat("<预览聊天>"); // Assumes renameChat uses current context
                        hasRenamed = true;
                        console.log(`${pluginName}: Preview chat renamed.`);
                    } catch (renameError) {
                        console.warn(`${pluginName}: Failed to rename preview chat after adding first message:`, renameError);
                        // Continue adding messages even if renaming fails
                    }
                }

                // Small delay between adding messages might help UI rendering
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (addError) {
                console.error(`${pluginName}: Error adding message (original mesid ${message.original_mesid_for_sort}) to preview chat:`, addError);
                // Optional: Decide whether to stop or continue on error
                // await callGenericPopup(`添加部分预览消息时出错，可能会不完整。\n错误: ${addError.message}`, POPUP_TYPE.WARNING);
                await new Promise(resolve => setTimeout(resolve, 200)); // Pause slightly on error
            }
        }

        console.log(`${pluginName}: Finished adding messages. Added ${addedCount} messages.`);
        await callGenericPopup(`已在预览聊天中成功加载 ${addedCount} 条收藏的消息。`, POPUP_TYPE.SUCCESS);

        // Close the favorites popup after successfully generating preview
        if (favoritesPopup) {
            favoritesPopup.hide();
        }

    } catch (error) {
        console.error(`${pluginName}: Unhandled error during preview favorites process:`, error);
        await callGenericPopup(`处理预览收藏时发生意外错误: ${error.message}`, POPUP_TYPE.ERROR);
    }
}


// --- jQuery(async () => { ... }) ---
// (Initialization Logic)
jQuery(async () => {
    // const pluginName = 'starZ'; // Defined globally at the top

    try {
        console.log(`${pluginName}: 插件加载中 (版本包含预览功能)...`);

        // Add button to the data bank wand container
        try {
            // Ensure the template path matches the plugin name
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);

            // Attach click handler to the main button (opens the popup)
            $('#favorites_button').on('click', () => {
                showFavoritesPopup(); // Calls the function that manages the popup
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings placeholder (if needed by the plugin)
        try {
            // Adjust container ID if needed ('extensions_settings', 'translation_container', etc.)
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#extensions_settings').append(settingsHtml); // Example container
            console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Set up event delegation for the favorite toggle icon on messages
        // Using 'body' or a more specific static parent like '#chat' can be more reliable
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);
        console.log(`${pluginName}: Event listener for .favorite-toggle-icon set up.`);

        // Initialize favorites array for the initially loaded chat
        ensureFavoritesArrayExists();

        // Initial UI setup for the loaded chat
        // Delay slightly to ensure messages are in the DOM
        setTimeout(() => {
             addFavoriteIconsToMessages();
             refreshFavoriteIconsInView();
             console.log(`${pluginName}: Initial favorite icons added and refreshed.`);
        }, 500); // 500ms delay might be safer


        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: ${event_types.CHAT_CHANGED} event detected. Updating icons...`);
            ensureFavoritesArrayExists(); // Ensure metadata structure exists for the new chat
            // Use setTimeout to allow the chat messages to render in the DOM first
            setTimeout(() => {
                addFavoriteIconsToMessages(); // Add icon structure if missing
                refreshFavoriteIconsInView(); // Update icon state based on new chat's metadata
            }, 300); // Delay might need adjustment
        });

        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIdString) => {
            // This event likely provides the *index* that was deleted.
            // We store mesid (string). We might need to re-think this or use handleClearInvalidFavorites.
            // For now, let's log it. A robust solution might involve checking favorites after deletion.
            console.log(`${pluginName}: ${event_types.MESSAGE_DELETED} event detected, potential index: ${deletedMessageIdString}. Manual 'Clear Invalid' recommended.`);
            // Option: Trigger a check or refresh?
            // refreshFavoriteIconsInView(); // Refresh icons, might hide the star if message is gone
            // Consider if we should try to remove the favorite proactively here, difficult without mesid.
        });

        // Listener for when new messages appear (sent or received)
        const handleNewMessage = (data) => {
             // Check if data contains message info, specifically the new message element or ID
             // console.log(`${pluginName}: New message event:`, data);
             // Delay slightly to ensure the message is fully added to the DOM
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Check all messages, add icon if needed
                 // No need to call refreshFavoriteIconsInView, new messages aren't favorited yet.
             }, 200); // Shorter delay might be sufficient
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);

        // Listener for when a message is updated (e.g., edited, regenerated swipe)
        eventSource.on(event_types.MESSAGE_UPDATED, (data) => {
             // This event might provide the updated message data or index/mesid
             // console.log(`${pluginName}: ${event_types.MESSAGE_UPDATED} event:`, data);
             // Refresh icons in case a favorited message was edited/swiped
             setTimeout(() => refreshFavoriteIconsInView(), 200);
        });


        // Listener for when more messages are loaded (scrolling up)
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: ${event_types.MORE_MESSAGES_LOADED} event detected. Updating icons...`);
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Add icons to newly loaded messages
                 refreshFavoriteIconsInView(); // Refresh state for all visible icons
             }, 300);
        });

        // MutationObserver remains a fallback/supplement, especially for complex UI updates
        // (Keep the existing MutationObserver code if deemed necessary)
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && ($(node).hasClass('mes') || $(node).find('.mes').length > 0)) {
                            // Check if it already has the icon to avoid redundant calls
                            const targetMessages = $(node).hasClass('mes') ? $(node) : $(node).find('.mes');
                            targetMessages.each(function() {
                                if ($(this).find('.extraMesButtons .favorite-toggle-icon').length === 0) {
                                     needsIconAddition = true;
                                }
                            });
                        }
                    });
                }
                // Also check for attribute changes if mesid might change? (Unlikely)
            }
            if (needsIconAddition) {
                 // Debounce this call heavily if it triggers frequently
                 clearTimeout(window.addIconsDebounceTimer);
                 window.addIconsDebounceTimer = setTimeout(() => {
                     console.log(`${pluginName}: MutationObserver triggered icon addition.`);
                     addFavoriteIconsToMessages();
                     refreshFavoriteIconsInView(); // Refresh might be needed if DOM manipulation changes things
                 }, 500); // Longer debounce for observer
            }
        });

        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true, // Observe direct children changes
                subtree: true    // Observe all descendants
            });
             console.log(`${pluginName}: MutationObserver watching #chat.`);
        } else {
             console.error(`${pluginName}: #chat element not found, MutationObserver not started.`);
        }


        console.log(`${pluginName}: Plugin loaded and initialized successfully!`);
    } catch (error) {
        console.error(`${pluginName}: CRITICAL ERROR during plugin initialization:`, error);
        // Inform the user if initialization fails critically
        callGenericPopup(`收藏插件 '${pluginName}' 初始化失败，部分功能可能无法使用。请检查浏览器控制台获取详细信息。`, POPUP_TYPE.ERROR);
    }
});
